import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import requests
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


SITE_BASE_URL = os.environ["SITE_BASE_URL"].rstrip("/")
WORKER_TOKEN = os.environ["AUTOMATION_WORKER_TOKEN"]
POLL_INTERVAL_SEC = int(os.environ.get("SYNTX_POLL_INTERVAL_SEC", "5"))
HEADLESS = os.environ.get("SYNTX_HEADLESS", "1") != "0"
MANUAL_SERVER = os.environ.get("SYNTX_MANUAL_SERVER", "0") == "1"
MANUAL_HOST = os.environ.get("SYNTX_MANUAL_HOST", "127.0.0.1")
MANUAL_PORT = int(os.environ.get("SYNTX_MANUAL_PORT", "8765"))
DEBUG_DIR = Path(os.environ.get("SYNTX_DEBUG_DIR", "workers/debug"))
COORDS_FILE = os.environ.get("SYNTX_COORDS_FILE", "").strip()
VIEWPORT_WIDTH = int(os.environ.get("SYNTX_VIEWPORT_WIDTH", "1365"))
VIEWPORT_HEIGHT = int(os.environ.get("SYNTX_VIEWPORT_HEIGHT", "768"))
HTTP = requests.Session()
HTTP.trust_env = False


def env_for_model(job: dict, suffix: str, default: str) -> str:
    model_key = str(job.get("model", "")).upper().replace("-", "_")
    return os.environ.get(f"SYNTX_{model_key}_{suffix}") or os.environ.get(f"SYNTX_{suffix}") or default


def api_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {WORKER_TOKEN}"}


def claim_job() -> dict | None:
    response = HTTP.post(
        f"{SITE_BASE_URL}/api/internal/syntx/jobs",
        headers=api_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json().get("job")


def complete_job(job_id: str, file_path: Path) -> None:
    with file_path.open("rb") as fh:
        response = HTTP.post(
            f"{SITE_BASE_URL}/api/internal/syntx/jobs/{job_id}/complete",
            headers=api_headers(),
            files={"file": (file_path.name, fh)},
            timeout=300,
        )
    response.raise_for_status()


def fail_job(job_id: str, error: str) -> None:
    response = HTTP.post(
        f"{SITE_BASE_URL}/api/internal/syntx/jobs/{job_id}/fail",
        headers={**api_headers(), "Content-Type": "application/json"},
        json={"error": error[:1000]},
        timeout=120,
    )
    if not response.ok:
        raise RuntimeError(f"{response.status_code}: {response.text[:1000]}")
    response.raise_for_status()


def save_debug_artifacts(page, job_id: str, label: str) -> str:
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    safe_label = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in label)[:60]
    base = DEBUG_DIR / f"syntx-{job_id}-{safe_label}"
    screenshot_path = base.with_suffix(".png")
    html_path = base.with_suffix(".html")
    try:
        page.screenshot(path=str(screenshot_path), full_page=True)
    except Exception as exc:
        print(f"failed to save screenshot: {exc}")
    try:
        html_path.write_text(page.content(), encoding="utf-8")
    except Exception as exc:
        print(f"failed to save html: {exc}")
    return f"{screenshot_path} / {html_path}"


def click_if_visible(page, selector: str, timeout_ms: int = 1500) -> bool:
    if not selector:
        return False
    locator = page.locator(selector).first
    try:
        if locator.is_visible(timeout=timeout_ms):
            locator.click(timeout=timeout_ms)
            return True
    except Exception:
        return False
    return False


def click_by_selector_js(page, selector: str) -> bool:
    if not selector:
        return False
    try:
        return bool(
            page.evaluate(
                """(selector) => {
                    const nodes = Array.from(document.querySelectorAll(selector));
                    const target = nodes.find((node) => {
                      const rect = node.getBoundingClientRect();
                      const style = window.getComputedStyle(node);
                      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    }) || nodes[0];
                    if (!target) return false;
                    target.click();
                    return true;
                }""",
                selector,
            )
        )
    except Exception:
        return False


def click_by_text(page, text: str, timeout_ms: int = 3000) -> bool:
    try:
        page.get_by_text(text, exact=False).first.click(timeout=timeout_ms)
        return True
    except Exception:
        pass

    # Vue/Element UI sometimes renders deeply nested spans; click the closest button.
    try:
        return bool(
            page.evaluate(
                """(text) => {
                    const needle = String(text).toLowerCase();
                    const nodes = Array.from(document.querySelectorAll('button, [role="button"], a'));
                    const target = nodes.find((node) => (node.innerText || node.textContent || '').toLowerCase().includes(needle));
                    if (!target) return false;
                    target.click();
                    return true;
                }""",
                text,
            )
        )
    except Exception:
        return False


def visible_ui_summary(page) -> str:
    try:
        data = page.evaluate(
            """() => {
                const pick = (selector) => Array.from(document.querySelectorAll(selector))
                  .filter((el) => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                  })
                  .slice(0, 40)
                  .map((el) => ({
                    tag: el.tagName.toLowerCase(),
                    text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
                    placeholder: el.getAttribute('placeholder') || '',
                    aria: el.getAttribute('aria-label') || '',
                    dataCy: el.getAttribute('data-cy') || '',
                    cls: el.getAttribute('class') || '',
                  }));
                return {
                  buttons: pick('button, [role="button"], a'),
                  inputs: pick('textarea, input, [contenteditable="true"], [role="textbox"]'),
                };
            }"""
        )
        return json.dumps(data, ensure_ascii=False)[:4000]
    except Exception as exc:
        return f"ui-summary-failed: {exc}"


def load_coordinate_profile(job: dict) -> dict | None:
    if not COORDS_FILE:
        return None
    path = Path(COORDS_FILE)
    if not path.exists():
        raise RuntimeError(f"SYNTX_COORDS_FILE not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    profile = data.get(str(job.get("model", "")))
    return profile if isinstance(profile, dict) else None


def point(profile: dict, key: str) -> tuple[float, float] | None:
    value = profile.get(key)
    if not isinstance(value, dict):
        return None
    x = value.get("x")
    y = value.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return float(x), float(y)


def click_point(page, profile: dict, key: str, required: bool = True) -> bool:
    p = point(profile, key)
    if not p:
        if required:
            raise RuntimeError(f"Coordinate {key!r} is not configured")
        return False
    page.mouse.click(p[0], p[1])
    return True


def prepare_syntx_page(page, job: dict) -> None:
    # Do not create projects here. The worker should use the current Syntx
    # generator page: select model/aspect, enter prompt, attach refs, generate.
    click_if_visible(page, "[data-cy='notification-banner-close-btn']")
    page.wait_for_timeout(500)
    click_if_visible(page, "[data-cy='session-list-chats-btn']", 2000)
    page.wait_for_timeout(500)
    if click_if_visible(page, "[data-cy='new-session-btn']", 2000) or click_by_selector_js(page, "[data-cy='new-session-btn']"):
        print("Syntx: clicked New session")
        page.wait_for_timeout(1500)


def run_coordinate_syntx_job(page, job: dict, download_dir: Path, profile: dict) -> Path:
    click_point(page, profile, "model_version_trigger")
    page.wait_for_timeout(500)
    click_point(page, profile, "model_first_option")
    page.wait_for_timeout(500)
    print("Syntx coordinates: selected model version")

    aspect = str(job.get("aspectRatio", "")).strip()
    aspect_options = profile.get("aspect_options") if isinstance(profile.get("aspect_options"), dict) else {}
    if point(profile, "aspect_trigger") and aspect in aspect_options:
        click_point(page, profile, "aspect_trigger")
        page.wait_for_timeout(500)
        p = aspect_options[aspect]
        page.mouse.click(float(p["x"]), float(p["y"]))
        page.wait_for_timeout(500)
        print(f"Syntx coordinates: selected aspect {aspect}")

    if job.get("referenceImages") and point(profile, "reference_upload"):
        files = download_reference_images(job, download_dir)
        if files:
            p = point(profile, "reference_upload")
            assert p is not None
            with page.expect_file_chooser(timeout=10_000) as chooser_info:
                page.mouse.click(p[0], p[1])
            chooser_info.value.set_files([str(file) for file in files])
            page.wait_for_timeout(1000)
            print(f"Syntx coordinates: attached {len(files)} reference image(s)")

    click_point(page, profile, "prompt")
    page.wait_for_timeout(200)
    page.keyboard.press("Control+A")
    page.keyboard.insert_text(str(job.get("prompt", "")))
    page.wait_for_timeout(500)
    print("Syntx coordinates: inserted prompt")

    generate_clicks = profile.get("generate_clicks")
    if isinstance(generate_clicks, list) and generate_clicks:
        generate_points = []
        for item in generate_clicks:
            if isinstance(item, dict) and isinstance(item.get("x"), (int, float)) and isinstance(item.get("y"), (int, float)):
                generate_points.append((float(item["x"]), float(item["y"])))
    else:
        generate_point = point(profile, "generate")
        if not generate_point:
            raise RuntimeError("Coordinate 'generate' is not configured")
        click_count = int(generate_clicks or 2) if isinstance(generate_clicks, (int, float, str)) else 2
        generate_points = [generate_point for _ in range(max(1, click_count))]

    for x, y in generate_points:
        page.mouse.click(x, y)
        page.wait_for_timeout(700)
    print(f"Syntx coordinates: clicked generate {len(generate_points)} time(s)")

    download_wait_ms = int(os.environ.get("SYNTX_COORD_DOWNLOAD_WAIT_MS", "15000"))
    page.wait_for_timeout(download_wait_ms)
    download_point = point(profile, "download")
    if not download_point:
        raise RuntimeError("Coordinate 'download' is not configured")

    deadline = time.time() + int(os.environ.get("SYNTX_TIMEOUT_MS", str(30 * 60 * 1000))) / 1000
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with page.expect_download(timeout=5000) as download_info:
                page.mouse.click(download_point[0], download_point[1])
            download = download_info.value
            filename = download.suggested_filename or f"{job['id']}.png"
            output_path = download_dir / filename
            download.save_as(output_path)
            return output_path
        except Exception as exc:
            last_error = exc
            page.wait_for_timeout(5000)

    raise RuntimeError(f"Syntx download did not start from coordinate. Last error: {last_error}")


def select_first_syntx_model(page, job: dict) -> None:
    """Optionally select the first model version on Syntx.

    Syntx UI is not a public API, so the exact dropdown selectors can be supplied
    per model through env:
      SYNTX_SORA_IMAGE_MODEL_TRIGGER_SELECTOR
      SYNTX_SORA_IMAGE_MODEL_TRIGGER_INDEX
      SYNTX_SORA_IMAGE_FIRST_MODEL_SELECTOR
    """

    if job.get("model") != "sora-image":
        return

    # On Sora Images the first dropdown is the model family ("Sora (GPT) Image"),
    # the second dropdown is the version ("GPT Image 1"). We must not switch the
    # family to Nano Banana; choose the first version inside the second dropdown.
    trigger_index_raw = env_for_model(job, "MODEL_TRIGGER_INDEX", "1")
    try:
        trigger_index = max(0, int(trigger_index_raw))
    except ValueError:
        trigger_index = 1
    trigger_selector = env_for_model(job, "MODEL_TRIGGER_SELECTOR", "")
    first_model_selector = env_for_model(
        job,
        "FIRST_MODEL_SELECTOR",
        ".el-select-dropdown__item:not(.is-disabled), [role='option']:not([aria-disabled='true'])",
    )

    try:
        if trigger_selector:
            page.locator(trigger_selector).nth(trigger_index).click(timeout=5000)
        else:
            ok = page.evaluate(
                """(triggerIndex) => {
                    const visible = (el) => {
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    };
                    const cards = Array.from(document.querySelectorAll('.settings-card, [class*="settings-card"], [class*="settings"]'))
                      .filter(visible);
                    const modelCard = cards.find((card) => /выбор модели|model/i.test(card.innerText || card.textContent || ''));
                    const root = modelCard || document;
                    const selects = Array.from(root.querySelectorAll('.el-select, [class*="ai-select"], [class*="select"]')).filter(visible);
                    const target = selects[triggerIndex] || selects[selects.length - 1];
                    if (!target) return false;
                    target.click();
                    return true;
                }""",
                trigger_index,
            )
            if not ok:
                raise RuntimeError("visible Sora model version dropdown was not found")
        page.locator(first_model_selector).first.click(timeout=5000)
        page.wait_for_timeout(500)
        print("Syntx: selected first model version")
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "first-model-not-selected")
        raise RuntimeError(
            f"Syntx first model version was not selected. "
            f"Set SYNTX_SORA_IMAGE_MODEL_TRIGGER_SELECTOR / SYNTX_SORA_IMAGE_MODEL_TRIGGER_INDEX / "
            f"SYNTX_SORA_IMAGE_FIRST_MODEL_SELECTOR. "
            f"Debug: {artifacts}"
        ) from exc


def select_syntx_aspect_ratio(page, job: dict) -> None:
    trigger_selector = env_for_model(job, "ASPECT_TRIGGER_SELECTOR", "")
    aspect = str(job.get("aspectRatio", "")).strip()
    if not trigger_selector or not aspect:
        return

    normalized = aspect.replace(":", "_")
    option_selector = (
        os.environ.get(f"SYNTX_{str(job.get('model', '')).upper().replace('-', '_')}_ASPECT_{normalized}_SELECTOR")
        or os.environ.get(f"SYNTX_ASPECT_{normalized}_SELECTOR")
        or f"text={aspect}"
    )

    try:
        page.locator(trigger_selector).first.click(timeout=5000)
        page.locator(option_selector).first.click(timeout=5000)
        page.wait_for_timeout(500)
        print(f"Syntx: selected aspect {aspect}")
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "aspect-not-selected")
        raise RuntimeError(
            f"Syntx aspect ratio was not selected. "
            f"Set SYNTX_SORA_IMAGE_ASPECT_TRIGGER_SELECTOR / SYNTX_ASPECT_{normalized}_SELECTOR. "
            f"Debug: {artifacts}"
        ) from exc


def download_reference_images(job: dict, download_dir: Path) -> list[Path]:
    out: list[Path] = []
    for idx, url in enumerate(job.get("referenceImages") or []):
        if not isinstance(url, str) or not url.strip():
            continue
        response = HTTP.get(url, timeout=120)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        ext = ".jpg"
        if "png" in content_type:
            ext = ".png"
        elif "webp" in content_type:
            ext = ".webp"
        elif "gif" in content_type:
            ext = ".gif"
        path = download_dir / f"reference-{idx + 1}{ext}"
        path.write_bytes(response.content)
        out.append(path)
    return out


def attach_reference_images(page, job: dict, download_dir: Path) -> None:
    upload_selector = env_for_model(job, "REFERENCE_UPLOAD_SELECTOR", "")
    if not upload_selector or not job.get("referenceImages"):
        return

    files = download_reference_images(job, download_dir)
    if not files:
        return

    try:
        page.locator(upload_selector).first.set_input_files([str(p) for p in files], timeout=30_000)
        page.wait_for_timeout(1000)
        print(f"Syntx: attached {len(files)} reference image(s)")
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "reference-not-attached")
        raise RuntimeError(
            f"Syntx reference images were not attached. Set SYNTX_SORA_IMAGE_REFERENCE_UPLOAD_SELECTOR. "
            f"Debug: {artifacts}"
        ) from exc


def run_syntx_job(job: dict, download_dir: Path) -> Path:
    """Run one Syntx job and return downloaded result path.

    Syntx has no public automation API here, so selectors are controlled by env.
    Start with SYNTX_HEADLESS=0, inspect the page, then set stable selectors:
      SYNTX_PROMPT_SELECTOR
      SYNTX_GENERATE_SELECTOR
      SYNTX_DOWNLOAD_SELECTOR
      optional: SYNTX_STORAGE_STATE for pre-authenticated browser state
    """

    prompt_selector = env_for_model(
        job,
        "PROMPT_SELECTOR",
        "textarea, [contenteditable='true'], input[type='text']",
    )
    generate_selector = env_for_model(
        job,
        "GENERATE_SELECTOR",
        "button:has-text('Generate'), button:has-text('Create'), button:has-text('Создать')",
    )
    download_selector = env_for_model(
        job,
        "DOWNLOAD_SELECTOR",
        "a:has-text('Download'), button:has-text('Download'), a[download]",
    )
    storage_state = os.environ.get("SYNTX_STORAGE_STATE")
    timeout_ms = int(os.environ.get("SYNTX_TIMEOUT_MS", str(30 * 60 * 1000)))
    slow_mo_ms = int(os.environ.get("SYNTX_SLOW_MO_MS", "0"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS, slow_mo=slow_mo_ms)
        context_kwargs = {"accept_downloads": True}
        if storage_state:
            context_kwargs["storage_state"] = storage_state
        context = browser.new_context(
            viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
            **context_kwargs,
        )
        page = context.new_page()

        page.goto(job["targetUrl"], wait_until="domcontentloaded", timeout=60_000)
        print(f"Syntx page: title={page.title()!r} url={page.url!r}")
        prepare_syntx_page(page, job)

        coordinate_profile = load_coordinate_profile(job)
        if coordinate_profile:
            result = run_coordinate_syntx_job(page, job, download_dir, coordinate_profile)
            context.close()
            browser.close()
            return result

        select_first_syntx_model(page, job)
        select_syntx_aspect_ratio(page, job)
        attach_reference_images(page, job, download_dir)

        try:
            page.locator(prompt_selector).first.fill(job["prompt"], timeout=60_000)
        except Exception as exc:
            artifacts = save_debug_artifacts(page, job["id"], "prompt-not-found")
            raise RuntimeError(
                f"Syntx prompt field not found by selector {prompt_selector!r}. "
                f"Page title={page.title()!r}, url={page.url!r}. Debug: {artifacts}. "
                f"Visible UI: {visible_ui_summary(page)}"
            ) from exc

        # If Syntx exposes explicit resolution/aspect controls, configure them with
        # extra env selectors in a site-specific revision of this worker.
        try:
            page.locator(generate_selector).first.click(timeout=60_000)
        except Exception as exc:
            artifacts = save_debug_artifacts(page, job["id"], "generate-not-found")
            raise RuntimeError(
                f"Syntx generate button not found by selector {generate_selector!r}. "
                f"Debug: {artifacts}"
            ) from exc

        try:
            page.locator(download_selector).first.wait_for(timeout=timeout_ms)
            with page.expect_download(timeout=120_000) as download_info:
                page.locator(download_selector).first.click()
            download = download_info.value
        except PlaywrightTimeoutError as exc:
            artifacts = save_debug_artifacts(page, job["id"], "download-timeout")
            raise RuntimeError(f"Syntx result download did not appear in time. Debug: {artifacts}") from exc

        filename = download.suggested_filename or f"{job['id']}.mp4"
        output_path = download_dir / filename
        download.save_as(output_path)
        context.close()
        browser.close()
        return output_path


def process_job(job: dict) -> None:
    job_id = job["id"]
    resolution = job.get("resolution") or "-"
    print(f"claimed {job_id}: {job['model']} {resolution} {job['aspectRatio']}")
    try:
        with tempfile.TemporaryDirectory(prefix="syntx-") as tmp:
            result_path = run_syntx_job(job, Path(tmp))
            complete_job(job_id, result_path)
            print(f"completed {job_id}: {result_path.name}")
    except Exception as exc:
        print(f"failed {job_id}: {exc}")
        try:
            fail_job(job_id, str(exc))
        except Exception as fail_exc:
            print(f"failed to report error for {job_id}: {fail_exc}")


class ManualWorkerHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/run":
            self._send_json(404, {"error": "not_found"})
            return

        expected = f"Bearer {WORKER_TOKEN}"
        if self.headers.get("Authorization", "") != expected:
            self._send_json(403, {"error": "forbidden"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length)
            payload = json.loads(raw.decode("utf-8"))
            job = payload["job"]
            if not isinstance(job, dict) or not job.get("id"):
                raise ValueError("job.id is required")
        except Exception as exc:
            self._send_json(400, {"error": str(exc)})
            return

        threading.Thread(target=process_job, args=(job,), daemon=True).start()
        self._send_json(202, {"ok": True, "jobId": job["id"]})

    def log_message(self, format: str, *args) -> None:
        print(f"[manual-worker] {format % args}")


def serve_manual_worker() -> None:
    server = ThreadingHTTPServer((MANUAL_HOST, MANUAL_PORT), ManualWorkerHandler)
    print(f"Syntx manual worker listening on http://{MANUAL_HOST}:{MANUAL_PORT}/run")
    server.serve_forever()


def main() -> None:
    if MANUAL_SERVER:
        serve_manual_worker()
        return

    while True:
        job = claim_job()
        if not job:
            time.sleep(POLL_INTERVAL_SEC)
            continue

        process_job(job)


if __name__ == "__main__":
    main()
