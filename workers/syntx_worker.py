import json
import mimetypes
import os
import shutil
import tempfile
import threading
import time
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from playwright.sync_api import sync_playwright


def syntx_safe_page_wait(page, ms: int) -> None:
    """Like page.wait_for_timeout, but fail clearly if the tab/browser was closed."""
    if ms <= 0:
        return
    try:
        page.wait_for_timeout(ms)
    except Exception as exc:
        name = type(exc).__name__.lower()
        msg = str(exc).lower()
        if "targetclosed" in name or "closed" in msg or "browser has been closed" in msg:
            raise RuntimeError(
                "Syntx: page or browser was closed during automation "
                "(tab closed, crash, or worker interrupt)."
            ) from exc
        raise


SITE_BASE_URL = os.environ["SITE_BASE_URL"].rstrip("/")


def worker_outbound_token() -> str:
    """Тот же приоритет, что у Next.js requireAutomationWorker (для /complete и internal API)."""
    return os.environ.get("SYNTX_WORKER_TOKEN", "").strip() or os.environ.get("AUTOMATION_WORKER_TOKEN", "").strip()


def worker_inbound_bearer_tokens() -> list[str]:
    """Токены, с которыми ручной воркер примет POST /run (кнопка в админке)."""
    seen: set[str] = set()
    out: list[str] = []
    for key in ("SYNTX_WORKER_TRIGGER_TOKEN", "SYNTX_WORKER_TOKEN", "AUTOMATION_WORKER_TOKEN"):
        v = os.environ.get(key, "").strip()
        if v and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def bearer_matches_worker_auth(candidate: str) -> bool:
    if not candidate:
        return False
    for t in worker_inbound_bearer_tokens():
        if len(candidate) != len(t):
            continue
        try:
            if hmac.compare_digest(candidate.encode("utf-8"), t.encode("utf-8")):
                return True
        except Exception:
            continue
    return False


def assert_worker_tokens_configured() -> None:
    if not worker_outbound_token():
        raise RuntimeError(
            "Задайте SYNTX_WORKER_TOKEN или AUTOMATION_WORKER_TOKEN — тем же значением, что в .env Next.js "
            "(requireAutomationWorker для POST /api/internal/syntx/jobs/.../complete)."
        )


POLL_INTERVAL_SEC = int(os.environ.get("SYNTX_POLL_INTERVAL_SEC", "5"))
HEADLESS = os.environ.get("SYNTX_HEADLESS", "1") != "0"
MANUAL_SERVER = os.environ.get("SYNTX_MANUAL_SERVER", "0") == "1"
MANUAL_HOST = os.environ.get("SYNTX_MANUAL_HOST", "127.0.0.1")
MANUAL_PORT = int(os.environ.get("SYNTX_MANUAL_PORT", "8765"))
DEBUG_DIR = Path(os.environ.get("SYNTX_DEBUG_DIR", "workers/debug"))
COORDS_FILE = os.environ.get("SYNTX_COORDS_FILE", "").strip()
VIEWPORT_WIDTH = int(os.environ.get("SYNTX_VIEWPORT_WIDTH", "1365"))
VIEWPORT_HEIGHT = int(os.environ.get("SYNTX_VIEWPORT_HEIGHT", "768"))
GENERATE_CLICK_COUNT = int(os.environ.get("SYNTX_GENERATE_CLICK_COUNT", "10"))
SMART_MODE = os.environ.get("SYNTX_SMART_MODE", "1") != "0"
NEW_SESSION_ENABLED = os.environ.get("SYNTX_NEW_SESSION", "0") == "1"


def ui_click_retries() -> int:
    return max(1, int(os.environ.get("SYNTX_UI_CLICK_RETRIES", "8")))


def ui_click_interval_ms() -> int:
    return max(50, int(os.environ.get("SYNTX_UI_CLICK_INTERVAL_MS", "250")))


HTTP = requests.Session()
HTTP.trust_env = False


def env_for_model(job: dict, suffix: str, default: str) -> str:
    model_key = str(job.get("model", "")).upper().replace("-", "_")
    return os.environ.get(f"SYNTX_{model_key}_{suffix}") or os.environ.get(f"SYNTX_{suffix}") or default


def api_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {worker_outbound_token()}"}


def resolve_reference_download_url(url: str) -> str:
    """Turn app-relative reference URLs into absolute URLs the worker can GET with Bearer token."""
    raw = (url or "").strip()
    if not raw:
        return raw
    if not raw.startswith(("http://", "https://")):
        raw = urljoin(SITE_BASE_URL + "/", raw.lstrip("/"))
    try:
        parsed = urlparse(raw)
    except ValueError:
        return raw
    path_only = parsed.path or ""
    marker = "/api/generations/reference-file/"
    if marker in path_only:
        idx = path_only.index(marker) + len(marker)
        name = path_only[idx:].split("/")[0].split("?")[0]
        if name:
            return f"{SITE_BASE_URL}/api/internal/syntx/reference-file/{name}"
    return raw


def syntx_repo_root() -> Path:
    """Корень репозитория (рядом с каталогом workers/)."""
    return Path(__file__).resolve().parent.parent


def syntx_runtime_generation_upload_dir() -> Path:
    """Тот же путь, что и saveLocalGenerationResultFile в Next (.runtime/uploads/generations)."""
    return syntx_repo_root() / ".runtime" / "uploads" / "generations"


def copy_syntx_result_to_repo_runtime(job_id: str, src: Path) -> Path:
    """Копия результата в проект — даже если POST /complete упадёт, файл уже на диске."""
    dest_dir = syntx_runtime_generation_upload_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = src.suffix if src.suffix else ".png"
    dest = dest_dir / f"{job_id}{ext}"
    shutil.copy2(src, dest)
    return dest


def claim_job() -> dict | None:
    response = HTTP.post(
        f"{SITE_BASE_URL}/api/internal/syntx/jobs",
        headers=api_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json().get("job")


def complete_job(job_id: str, file_path: Path) -> None:
    mime, _ = mimetypes.guess_type(str(file_path))
    if not mime or mime == "application/octet-stream":
        ext = file_path.suffix.lower()
        if ext == ".png":
            mime = "image/png"
        elif ext in (".jpg", ".jpeg"):
            mime = "image/jpeg"
        elif ext == ".webp":
            mime = "image/webp"
        elif ext == ".gif":
            mime = "image/gif"
        elif ext == ".mp4":
            mime = "video/mp4"
        else:
            mime = "application/octet-stream"
    with file_path.open("rb") as fh:
        response = HTTP.post(
            f"{SITE_BASE_URL}/api/internal/syntx/jobs/{job_id}/complete",
            headers=api_headers(),
            files={"file": (file_path.name, fh, mime)},
            timeout=300,
        )
    if not response.ok:
        raise RuntimeError(f"Syntx complete HTTP {response.status_code}: {response.text[:2500]}")
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


def visible_count(page, selector: str) -> int:
    try:
        value = page.evaluate(
            """(selector) => {
                const visible = (el) => {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                };
                return Array.from(document.querySelectorAll(selector)).filter(visible).length;
            }""",
            selector,
        )
        return int(value or 0)
    except Exception:
        return 0


def syntx_interactive_count(page) -> int:
    try:
        value = page.evaluate(
            """() => {
                const visible = (el) => {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                };
                return Array.from(document.querySelectorAll(
                  'button, [role="button"], a, textarea, input, [contenteditable="true"], [role="textbox"], .el-select, [class*="select"]'
                )).filter(visible).length;
            }"""
        )
        return int(value or 0)
    except Exception:
        return 0


def syntx_session_drawer_open(page) -> bool:
    """True when the session list sidebar is expanded (Syntx uses session-list-layout__wrapper--show)."""
    try:
        return bool(
            page.evaluate(
                """() => {
                    const wrap = document.querySelector('.session-list-layout__wrapper--show');
                    if (!wrap) return false;
                    const rect = wrap.getBoundingClientRect();
                    const st = window.getComputedStyle(wrap);
                    return rect.width > 20 && rect.height > 20 && st.display !== 'none' && st.visibility !== 'hidden';
                }"""
            )
        )
    except Exception:
        return False


def close_syntx_session_list(page) -> None:
    attempts = max(3, int(os.environ.get("SYNTX_SESSION_DRAWER_CLOSE_ATTEMPTS", "12")))
    for _ in range(attempts):
        if not syntx_session_drawer_open(page):
            print("Syntx: closed session list")
            return

        close_selectors = [
            ".session-list-layout__header [data-cy='session-list-close-btn']",
            "[data-cy='session-list-close-btn']",
        ]
        clicked = False
        for sel in close_selectors:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.click(force=True, timeout=3000)
                    clicked = True
                    break
            except Exception:
                continue
        if not clicked:
            click_if_visible(page, "[data-cy='session-list-btn']", 1000) or click_by_selector_js(
                page, "[data-cy='session-list-btn']"
            )
        for _ in range(2):
            page.keyboard.press("Escape")
        try:
            page.locator(".image-chat-page .chat-layout__workspace, .chat-layout__workspace").first.click(
                force=True, timeout=2000, position={"x": 24, "y": 24}
            )
        except Exception:
            pass
        page.wait_for_timeout(400)

    if syntx_session_drawer_open(page):
        print("Syntx: session list is still visible")
    else:
        print("Syntx: closed session list")


def open_syntx_chat_settings(page) -> None:
    # Model family + version live under #teleport-ai-select (see Syntx DOM); avoid counting random selects globally.
    controls_selector = '#teleport-ai-select .el-select.el-select--small, [id="teleport-ai-select"] .el-select.el-select--small'
    if visible_count(page, controls_selector) >= 2:
        return
    close_syntx_session_list(page)
    click_if_visible(page, "button.ai-select__tooltip-close", 1200) or click_if_visible(
        page, ".ai-select__tooltip-close", 1200
    )
    page.wait_for_timeout(200)

    for _ in range(ui_click_retries()):
        if visible_count(page, controls_selector) >= 2:
            print("Syntx: opened chat settings")
            return
        try:
            loc = page.locator("[data-cy='chat-info-header-btn']").first
            if loc.is_visible(timeout=1200):
                loc.click(force=True, timeout=4000)
        except Exception:
            click_by_selector_js(page, "[data-cy='chat-info-header-btn']")
        page.wait_for_timeout(ui_click_interval_ms())

    if visible_count(page, controls_selector) >= 2:
        print("Syntx: opened chat settings")
    else:
        print("Syntx: chat settings button clicked, model controls still hidden")


def click_syntx_sora_version_dropdown(page) -> bool:
    """Open the Sora *version* dropdown (second small el-select under #teleport-ai-select)."""
    return open_teleport_el_select_small_with_feedback(page, 1)


def teleport_el_select_combobox_expanded(page, trigger_index: int) -> bool:
    try:
        return bool(
            page.evaluate(
                """(triggerIndex) => {
                    const root = document.querySelector('#teleport-ai-select') || document.querySelector('[id="teleport-ai-select"]');
                    const visible = (el) => {
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    };
                    if (!root) return false;
                    const selects = Array.from(root.querySelectorAll('.el-select.el-select--small')).filter(visible);
                    const sel = selects[triggerIndex];
                    if (!sel) return false;
                    const input = sel.querySelector('[role="combobox"]');
                    return !!(input && input.getAttribute('aria-expanded') === 'true');
                }""",
                trigger_index,
            )
        )
    except Exception:
        return False


def click_teleport_el_select_small_js(page, trigger_index: int) -> bool:
    try:
        return bool(
            page.evaluate(
                """(triggerIndex) => {
                    const root = document.querySelector('#teleport-ai-select') || document.querySelector('[id="teleport-ai-select"]');
                    const visible = (el) => {
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    };
                    if (!root) return false;
                    const selects = Array.from(root.querySelectorAll('.el-select.el-select--small')).filter(visible);
                    const target = selects[triggerIndex] || selects[selects.length - 1];
                    if (!target) return false;
                    target.scrollIntoView({ block: 'center', inline: 'center' });
                    const wrap = target.querySelector('.el-select__wrapper') || target;
                    wrap.click();
                    return true;
                }""",
                trigger_index,
            )
        )
    except Exception:
        return False


def click_teleport_el_select_small_once(page, trigger_index: int) -> bool:
    root = page.locator('#teleport-ai-select, [id="teleport-ai-select"]').first
    try:
        if root.count() == 0:
            return click_teleport_el_select_small_js(page, trigger_index)
        sel = root.locator(".el-select.el-select--small").nth(trigger_index)
        wrap = sel.locator(".el-select__wrapper").first
        if wrap.count() > 0:
            wrap.click(force=True, timeout=4000)
            return True
        sel.click(force=True, timeout=4000)
        return True
    except Exception:
        return click_teleport_el_select_small_js(page, trigger_index)


def open_teleport_el_select_small_with_feedback(page, trigger_index: int) -> bool:
    """Open Element Plus select under #teleport-ai-select; retries until aria-expanded=true on that row."""
    if teleport_el_select_combobox_expanded(page, trigger_index):
        return True
    for _ in range(ui_click_retries()):
        click_teleport_el_select_small_once(page, trigger_index)
        page.wait_for_timeout(ui_click_interval_ms())
        if teleport_el_select_combobox_expanded(page, trigger_index):
            return True
    return teleport_el_select_combobox_expanded(page, trigger_index)


def click_teleport_el_select_small(page, trigger_index: int) -> bool:
    """Single attempt; prefer open_teleport_el_select_small_with_feedback for flaky Syntx UI."""
    return click_teleport_el_select_small_once(page, trigger_index)


def aspect_ratio_combobox_expanded(page) -> bool:
    try:
        return bool(
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-cy="aspect-ration-select-menu"]');
                    if (!el) return false;
                    const input = el.querySelector('[role="combobox"]');
                    return !!(input && input.getAttribute('aria-expanded') === 'true');
                }"""
            )
        )
    except Exception:
        return False


def open_aspect_ratio_dropdown_with_feedback(page) -> bool:
    if aspect_ratio_combobox_expanded(page):
        return True
    trigger = page.locator('[data-cy="aspect-ration-select-menu"]').first
    wrap = trigger.locator(".el-select__wrapper").first
    for _ in range(ui_click_retries()):
        try:
            if wrap.is_visible(timeout=1200):
                wrap.click(force=True, timeout=4000)
            else:
                trigger.click(force=True, timeout=4000)
        except Exception:
            try:
                trigger.click(force=True, timeout=4000)
            except Exception:
                pass
        page.wait_for_timeout(ui_click_interval_ms())
        if aspect_ratio_combobox_expanded(page) or visible_count(page, ".el-select-dropdown__item") > 0:
            return True
    return aspect_ratio_combobox_expanded(page)


def wait_for_syntx_app_ready(page, job: dict) -> None:
    timeout_ms = int(os.environ.get("SYNTX_APP_READY_TIMEOUT_MS", "90000"))
    attempts = int(os.environ.get("SYNTX_APP_READY_RELOADS", "2"))

    for attempt in range(attempts + 1):
        deadline = time.time() + timeout_ms / 1000
        while time.time() < deadline:
            if syntx_interactive_count(page) > 0:
                print("Syntx app is ready")
                return
            page.wait_for_timeout(1000)

        if attempt < attempts:
            print("Syntx app is still on splash screen, reloading page")
            page.reload(wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_timeout(2000)

    artifacts = save_debug_artifacts(page, job["id"], "app-not-ready")
    raise RuntimeError(f"Syntx app did not finish loading. Debug: {artifacts}. Visible UI: {visible_ui_summary(page)}")


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


def visible_elements(page) -> list[dict]:
    try:
        data = page.evaluate(
            """() => {
                const visible = (el) => {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                };
                return Array.from(document.querySelectorAll(
                  'button, [role="button"], a, textarea, input, [contenteditable="true"], [role="textbox"], .el-select, [class*="select"], [class*="dropdown"]'
                ))
                  .filter(visible)
                  .slice(0, 120)
                  .map((el) => ({
                    tag: el.tagName.toLowerCase(),
                    text: (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
                    placeholder: el.getAttribute('placeholder') || '',
                    aria: el.getAttribute('aria-label') || '',
                    title: el.getAttribute('title') || '',
                    dataCy: el.getAttribute('data-cy') || '',
                    cls: el.getAttribute('class') || '',
                  }));
            }"""
        )
        return data if isinstance(data, list) else []
    except Exception:
        return []


def smart_click_by_candidates(
    page,
    candidates: list[str],
    selector: str = "button, [role='button'], a, [class*='select'], [class*='dropdown'], .el-select, .el-select-dropdown__item, [role='option']",
    timeout_ms: int = 10_000,
) -> bool:
    cleaned = [candidate.strip().lower() for candidate in candidates if candidate and candidate.strip()]
    if not cleaned:
        return False

    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        try:
            result = page.evaluate(
                """({ selector, candidates }) => {
                    const visible = (el) => {
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    };
                    const disabled = (el) =>
                      el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|is-disabled/i.test(el.className || '');
                    const textOf = (el) => [
                      el.innerText || el.textContent || '',
                      el.getAttribute('aria-label') || '',
                      el.getAttribute('title') || '',
                      el.getAttribute('placeholder') || '',
                      el.getAttribute('data-cy') || '',
                      el.className || '',
                    ].join(' ').replace(/\\s+/g, ' ').trim().toLowerCase();
                    const nodes = Array.from(document.querySelectorAll(selector)).filter(visible);
                    const scored = [];
                    for (const node of nodes) {
                      const clickable = node.closest('button, [role="button"], a, [role="option"], .el-select-dropdown__item') || node;
                      if (disabled(clickable) || disabled(node)) continue;
                      const text = textOf(node);
                      let score = 0;
                      for (const candidate of candidates) {
                        if (!candidate) continue;
                        if (text === candidate) score = Math.max(score, 100);
                        if (text.includes(candidate)) score = Math.max(score, 60 + Math.min(candidate.length, 30));
                        if (candidate.includes(text) && text.length >= 2) score = Math.max(score, 30 + Math.min(text.length, 20));
                      }
                      if (score > 0) scored.push({ node, clickable, score, text });
                    }
                    scored.sort((a, b) => b.score - a.score);
                    const match = scored[0];
                    if (!match) return null;
                    match.clickable.scrollIntoView({ block: 'center', inline: 'center' });
                    match.clickable.click();
                    return { text: match.text, score: match.score };
                }""",
                {"selector": selector, "candidates": cleaned},
            )
            if result:
                return True
        except Exception:
            pass
        page.wait_for_timeout(500)
    return False


def smart_fill_prompt(page, prompt: str) -> bool:
    try:
        point_data = page.evaluate(
            """() => {
                const visible = (el) => {
                  const rect = el.getBoundingClientRect();
                  const style = window.getComputedStyle(el);
                  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                };
                const scoreInput = (el) => {
                  const rect = el.getBoundingClientRect();
                  const text = [
                    el.getAttribute('placeholder') || '',
                    el.getAttribute('aria-label') || '',
                    el.getAttribute('data-cy') || '',
                    el.className || '',
                  ].join(' ').toLowerCase();
                  let score = Math.min(rect.width * rect.height / 1000, 120);
                  if (el.tagName.toLowerCase() === 'textarea') score += 80;
                  if (el.getAttribute('contenteditable') === 'true') score += 50;
                  if (el.getAttribute('role') === 'textbox') score += 50;
                  if (/prompt|message|describe|опис|промпт|сообщ/i.test(text)) score += 80;
                  return score;
                };
                const inputs = Array.from(document.querySelectorAll(
                  'textarea, [contenteditable="true"], [role="textbox"], input[type="text"], input:not([type])'
                )).filter(visible);
                inputs.sort((a, b) => scoreInput(b) - scoreInput(a));
                const target = inputs[0];
                if (!target) return null;
                target.scrollIntoView({ block: 'center', inline: 'center' });
                target.focus();
                const rect = target.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }"""
        )
        if not point_data:
            return False
        page.mouse.click(float(point_data["x"]), float(point_data["y"]))
        page.wait_for_timeout(200)
        page.keyboard.press("Control+A")
        page.keyboard.insert_text(prompt)
        page.wait_for_timeout(500)
        return True
    except Exception:
        return False


def smart_select_option(page, trigger_candidates: list[str], option_candidates: list[str], timeout_ms: int = 10_000) -> bool:
    if not smart_click_by_candidates(page, trigger_candidates, timeout_ms=timeout_ms):
        return False
    page.wait_for_timeout(500)
    return smart_click_by_candidates(
        page,
        option_candidates,
        selector=".el-select-dropdown__item, [role='option'], li, button, [role='button'], a",
        timeout_ms=timeout_ms,
    )


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
    close_syntx_session_list(page)
    if NEW_SESSION_ENABLED:
        if click_if_visible(page, "[data-cy='new-session-btn']", 2000) or click_by_selector_js(
            page, "[data-cy='new-session-btn']"
        ):
            print("Syntx: clicked New session")
            page.wait_for_timeout(1500)
            close_syntx_session_list(page)
    open_syntx_chat_settings(page)


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
        if generate_points and len(generate_points) < GENERATE_CLICK_COUNT:
            generate_points.extend([generate_points[-1]] * (GENERATE_CLICK_COUNT - len(generate_points)))
    else:
        generate_point = point(profile, "generate")
        if not generate_point:
            raise RuntimeError("Coordinate 'generate' is not configured")
        click_count = int(generate_clicks or GENERATE_CLICK_COUNT) if isinstance(generate_clicks, (int, float, str)) else GENERATE_CLICK_COUNT
        generate_points = [generate_point for _ in range(max(1, click_count))]

    for x, y in generate_points:
        page.mouse.click(x, y)
        page.wait_for_timeout(700)
        if syntx_generation_in_progress(page):
            print(f"Syntx coordinates: generation in progress after click at ({x}, {y})")
            break
    print(f"Syntx coordinates: clicked generate {len(generate_points)} time(s)")

    download_wait_ms = int(os.environ.get("SYNTX_COORD_DOWNLOAD_WAIT_MS", "15000"))
    page.wait_for_timeout(download_wait_ms)
    download_point = point(profile, "download")
    if not download_point:
        raise RuntimeError("Coordinate 'download' is not configured")

    deadline = time.time() + int(os.environ.get("SYNTX_TIMEOUT_MS", str(30 * 60 * 1000))) / 1000
    last_error: Exception | None = None
    while time.time() < deadline:
        for _ in range(max(1, int(os.environ.get("SYNTX_DOWNLOAD_SCROLL_STEPS", "4")))):
            syntx_scroll_chat_toward_bottom(page)
            page.wait_for_timeout(150)
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

    open_syntx_chat_settings(page)

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
            for _ in range(ui_click_retries()):
                page.locator(trigger_selector).nth(trigger_index).click(force=True, timeout=5000)
                page.wait_for_timeout(ui_click_interval_ms())
                if visible_count(page, ".el-select-dropdown__item") > 0:
                    break
        else:
            if not open_teleport_el_select_small_with_feedback(page, trigger_index):
                raise RuntimeError("Sora model version dropdown did not open (combobox stayed collapsed)")

        picked = False
        for _ in range(ui_click_retries()):
            try:
                page.locator(first_model_selector).first.click(force=True, timeout=5000)
                page.wait_for_timeout(450)
                picked = True
                break
            except Exception:
                if trigger_selector:
                    page.locator(trigger_selector).nth(trigger_index).click(force=True, timeout=5000)
                elif not open_teleport_el_select_small_with_feedback(page, trigger_index):
                    break
                page.wait_for_timeout(ui_click_interval_ms())
        if not picked:
            raise RuntimeError("first model option click did not succeed")
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
    if not aspect:
        return

    if not trigger_selector and job.get("model") == "sora-image":
        trigger_selector = '[data-cy="aspect-ration-select-menu"]'

    if not trigger_selector:
        return

    normalized = aspect.replace(":", "_")
    option_selector = (
        os.environ.get(f"SYNTX_{str(job.get('model', '')).upper().replace('-', '_')}_ASPECT_{normalized}_SELECTOR")
        or os.environ.get(f"SYNTX_ASPECT_{normalized}_SELECTOR")
        or f"text={aspect}"
    )

    try:
        for _ in range(ui_click_retries()):
            try:
                page.locator(trigger_selector).first.locator(".el-select__wrapper").click(force=True, timeout=5000)
            except Exception:
                page.locator(trigger_selector).first.click(force=True, timeout=5000)
            page.wait_for_timeout(ui_click_interval_ms())
            if visible_count(page, ".el-select-dropdown__item") > 0:
                break
        page.locator(option_selector).first.click(force=True, timeout=5000)
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
        fetch_url = resolve_reference_download_url(url)
        response = HTTP.get(fetch_url, headers=api_headers(), timeout=120)
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


def smart_select_sora_model_version(page, job: dict) -> bool:
    if job.get("model") != "sora-image":
        return True

    try:
        open_syntx_chat_settings(page)
        if not click_syntx_sora_version_dropdown(page):
            return False
        page.wait_for_timeout(500)
        if smart_click_by_candidates(
            page,
            ["GPT Image 1", "GPT Image 2", "Image 1", "Image 2", "first", "перв"],
            selector=".el-select-dropdown__item, [role='option'], li, button, [role='button']",
            timeout_ms=5000,
        ):
            print("Syntx smart: selected Sora model version")
            return True
        option = page.locator(".el-select-dropdown__item:not(.is-disabled), [role='option']:not([aria-disabled='true'])").first
        option.click(timeout=5000)
        page.wait_for_timeout(500)
        print("Syntx smart: selected first visible Sora model version")
        return True
    except Exception:
        return False


def smart_select_aspect_ratio(page, job: dict) -> bool:
    aspect = str(job.get("aspectRatio", "")).strip()
    if not aspect:
        return True

    if job.get("model") == "sora-image":
        try:
            trigger = page.locator('[data-cy="aspect-ration-select-menu"]').first
            if trigger.is_visible(timeout=2000):
                if open_aspect_ratio_dropdown_with_feedback(page):
                    page.wait_for_timeout(200)
                    if smart_click_by_candidates(
                        page,
                        [aspect],
                        selector=".el-select-dropdown__item, [role='option'], li",
                        timeout_ms=5000,
                    ):
                        print(f"Syntx smart: selected aspect {aspect} (aspect-ration-select-menu)")
                        return True
        except Exception:
            pass

    if smart_click_by_candidates(
        page,
        [aspect],
        selector=".el-select-dropdown__item, [role='option'], li, button, [role='button']",
        timeout_ms=1500,
    ):
        print(f"Syntx smart: selected aspect {aspect}")
        return True

    trigger_candidates = [aspect, "Aspect", "Ratio", "Size", "Format", "Соотношение", "Размер", "Формат"]
    if smart_select_option(page, trigger_candidates, [aspect], timeout_ms=5000):
        print(f"Syntx smart: selected aspect {aspect}")
        return True

    return False


def smart_attach_reference_images(page, job: dict, download_dir: Path) -> None:
    if not job.get("referenceImages"):
        return

    files = download_reference_images(job, download_dir)
    if not files:
        return

    try:
        page.locator("input[type='file']").first.set_input_files([str(p) for p in files], timeout=10_000)
        page.wait_for_timeout(1000)
        print(f"Syntx smart: attached {len(files)} reference image(s)")
        return
    except Exception:
        pass

    try:
        with page.expect_file_chooser(timeout=10_000) as chooser_info:
            ok = smart_click_by_candidates(
                page,
                ["Upload", "Reference", "Image", "Attach", "Добавить", "Загрузить", "Референс"],
                selector="button, [role='button'], a, label, [class*='upload'], [class*='reference']",
                timeout_ms=5000,
            )
            if not ok:
                raise RuntimeError("reference upload control was not found")
        chooser_info.value.set_files([str(file) for file in files])
        page.wait_for_timeout(1000)
        print(f"Syntx smart: attached {len(files)} reference image(s)")
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "smart-reference-not-attached")
        raise RuntimeError(f"Syntx smart reference upload failed. Debug: {artifacts}") from exc


def syntx_generation_in_progress(page) -> bool:
    """Heuristic: Syntx started processing (uploading / loading overlay in workspace)."""
    try:
        return bool(
            page.evaluate(
                """() => {
                    const visible = (el) => {
                      if (!el) return false;
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    };
                    const root =
                      document.querySelector('.chat-layout__workspace') ||
                      document.querySelector('.chat__content');
                    if (root) {
                      const imgs = Array.from(root.querySelectorAll('img')).filter(visible);
                      const hasResult = imgs.some((img) => {
                        const nw = img.naturalWidth || 0;
                        const nh = img.naturalHeight || 0;
                        const r = img.getBoundingClientRect();
                        if (r.width > 220 && r.height > 220) return true;
                        return nw > 160 && nh > 160 && r.width > 64 && r.height > 64;
                      });
                      if (hasResult) return false;
                    }
                    const queries = [
                      '.chat-input__container[uploading="true"]',
                      '.chat-layout__workspace .el-loading-spinner',
                      '.chat-layout__workspace .el-loading-parent--relative .el-loading',
                      '.chat-layout__workspace [class*="is-loading"]',
                      '[aria-busy="true"]',
                    ];
                    for (const q of queries) {
                      const el = document.querySelector(q);
                      if (el && visible(el)) return true;
                    }
                    return false;
                }"""
            )
        )
    except Exception:
        return False


def click_syntx_chat_send_button(page) -> bool:
    """Syntx image chat send is icon-only (no 'Generate' text): primary .ml-2.chat-input__button."""
    selectors = [
        ".chat-input__actions-right button.ml-2.chat-input__button",
        ".chat-input__actions-right button.chat-input__button.ml-2",
        "button.ml-2.chat-input__button",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.count() == 0:
                continue
            loc.scroll_into_view_if_needed(timeout=3000)
            loc.click(force=True, timeout=5000)
            return True
        except Exception:
            continue
    try:
        return bool(
            page.evaluate(
                """() => {
                    const visible = (el) => {
                      if (!el) return false;
                      const rect = el.getBoundingClientRect();
                      const style = window.getComputedStyle(el);
                      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    };
                    const root = document.querySelector('.chat-input__container') || document.querySelector('.chat-input');
                    if (!root) return false;
                    const right = root.querySelector('.chat-input__actions-right');
                    if (!right) return false;
                    const buttons = Array.from(right.querySelectorAll('button.chat-input__button')).filter(
                      (b) => visible(b) && !b.closest('.voice-recorder')
                    );
                    const target =
                      buttons.find((b) => (b.className || '').includes('ml-2')) || buttons[buttons.length - 1];
                    if (!target) return false;
                    target.scrollIntoView({ block: 'center', inline: 'center' });
                    target.click();
                    return true;
                }"""
            )
        )
    except Exception:
        return False


def smart_try_generate_click(page, job: dict) -> bool:
    """Text/aria match, optional env selector, then Syntx icon send."""
    custom = env_for_model(job, "GENERATE_SELECTOR", "").strip()
    if custom:
        try:
            page.locator(custom).first.click(force=True, timeout=5000)
            return True
        except Exception:
            pass
    if smart_click_by_candidates(
        page,
        ["Generate", "Create", "Создать", "Сгенерировать", "Send", "Отправить"],
        selector="button, [role='button'], a",
        timeout_ms=3500,
    ):
        return True
    return click_syntx_chat_send_button(page)


def smart_click_generate(page, job: dict) -> None:
    interval = max(200, int(os.environ.get("SYNTX_GENERATE_CLICK_INTERVAL_MS", "450")))
    burst = max(1, int(os.environ.get("SYNTX_GENERATE_BURST_CLICKS", "12")))
    any_clicked = False
    for click_idx in range(1, GENERATE_CLICK_COUNT + 1):
        if job.get("model") == "sora-image" and syntx_result_image_visible(page):
            print("Syntx smart: Sora result image already visible, skipping further generate clicks")
            return
        if syntx_generation_in_progress(page):
            print(f"Syntx smart: generation already in progress before generate round {click_idx}")
            return
        for sub in range(burst):
            if smart_try_generate_click(page, job):
                any_clicked = True
            syntx_safe_page_wait(page, 80)
            if job.get("model") == "sora-image" and syntx_result_image_visible(page):
                print("Syntx smart: Sora result visible during generate burst, stopping")
                return
            if syntx_generation_in_progress(page):
                print(f"Syntx smart: generation in progress after round {click_idx}, burst step {sub + 1}")
                return
        for _ in range(24):
            syntx_safe_page_wait(page, 150)
            if job.get("model") == "sora-image" and syntx_result_image_visible(page):
                print("Syntx smart: Sora result visible while waiting for progress heuristics, stopping")
                return
            if syntx_generation_in_progress(page):
                print(f"Syntx smart: generation in progress after {click_idx} generate round(s)")
                return
        syntx_safe_page_wait(page, interval)

    if not any_clicked:
        artifacts = save_debug_artifacts(page, job["id"], "smart-generate-not-found")
        sel_hint = env_for_model(job, "GENERATE_SELECTOR", "") or "(not set)"
        raise RuntimeError(
            f"Syntx smart generate control not found (no labeled button, "
            f"SYNTX_*_GENERATE_SELECTOR={sel_hint!r}, no .ml-2.chat-input__button). "
            f"Debug: {artifacts}. Visible UI: {visible_ui_summary(page)}"
        )

    if syntx_generation_in_progress(page):
        print(f"Syntx smart: generation in progress after {GENERATE_CLICK_COUNT} generate round(s)")
    else:
        print(
            f"Syntx smart: finished {GENERATE_CLICK_COUNT} generate round(s) ({burst} burst clicks each); "
            "no loading/upload heuristic detected (continuing to download wait)"
        )


def syntx_focus_chat_for_scroll(page) -> None:
    """Focus the image chat column so wheel / End apply to the message list, not the sidebar."""
    for sel in (
        ".chat-layout__workspace .chat__content",
        ".chat-layout__workspace",
        ".chat .chat__content",
        ".image-chat-page .chat-layout__main",
    ):
        try:
            loc = page.locator(sel).first
            if loc.count() == 0:
                continue
            loc.click(force=True, timeout=2500, position={"x": 32, "y": 120})
            return
        except Exception:
            continue


def syntx_scroll_chat_snap_bottom_js(page) -> bool:
    """Snap all scrollable layers inside the image chat to bottom; scroll last image into view."""
    try:
        return bool(
            page.evaluate(
                """() => {
                    const visible = (el) => {
                      if (!el) return false;
                      const rect = el.getBoundingClientRect();
                      const st = window.getComputedStyle(el);
                      return rect.width > 24 && rect.height > 24 && st.display !== 'none' && st.visibility !== 'hidden';
                    };
                    const regions = Array.from(
                      document.querySelectorAll(
                        '.image-chat-page, .chat-layout__workspace, .container.chat-layout__main, .chat .chat__content, .chat__content'
                      )
                    ).filter(visible);
                    let moved = false;
                    for (const region of regions) {
                      if (region.scrollHeight > region.clientHeight + 8) {
                        region.scrollTop = region.scrollHeight;
                        moved = true;
                      }
                      const scrollables = region.querySelectorAll(
                        '.el-scrollbar__wrap, .el-scrollbar__view, [data-overlayscrollbars-viewport], .os-viewport'
                      );
                      scrollables.forEach((el) => {
                        if (!visible(el)) return;
                        if (el.scrollHeight > el.clientHeight + 8) {
                          el.scrollTop = el.scrollHeight;
                          moved = true;
                        }
                      });
                    }
                    const imgs = Array.from(
                      document.querySelectorAll(
                        '.chat-layout__workspace img[src], .chat__content img[src], .image-chat-page .chat img[src]'
                      )
                    ).filter(visible);
                    if (imgs.length) {
                      imgs[imgs.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
                      moved = true;
                    }
                    const bubbles = Array.from(
                      document.querySelectorAll(
                        '.chat-layout__workspace [class*="message"], .chat__content [class*="message"], .chat-item'
                      )
                    ).filter(visible);
                    if (bubbles.length) {
                      bubbles[bubbles.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
                      moved = true;
                    }
                    return moved;
                }"""
            )
        )
    except Exception:
        return False


def syntx_scroll_chat_toward_bottom(page, pixels: int | None = None) -> None:
    """Scroll the Syntx chat so the latest image and per-message Download controls are visible."""
    px = int(pixels if pixels is not None else int(os.environ.get("SYNTX_DOWNLOAD_SCROLL_PX", "720")))
    if os.environ.get("SYNTX_DOWNLOAD_SCROLL_SNAP_FIRST", "1") != "0":
        syntx_focus_chat_for_scroll(page)
        syntx_scroll_chat_snap_bottom_js(page)
        for _ in range(3):
            page.keyboard.press("End")
            page.wait_for_timeout(80)

    custom = os.environ.get("SYNTX_CHAT_SCROLL_SELECTOR", "").strip()
    selectors = [s.strip() for s in custom.split(",") if s.strip()] if custom else [
        ".chat-layout__workspace .el-scrollbar__wrap",
        ".chat__content .el-scrollbar__wrap",
        ".chat .el-scrollbar__wrap",
        ".chat-layout__workspace",
        ".image-chat-page .chat-layout__main",
        ".chat__content",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.count() == 0:
                continue
            loc.scroll_into_view_if_needed(timeout=2500)
            loc.hover(timeout=2000)
            page.mouse.wheel(0, px)
            return
        except Exception:
            continue
    try:
        page.evaluate(
            """(delta) => {
                const visible = (el) => {
                  if (!el) return false;
                  const rect = el.getBoundingClientRect();
                  const st = window.getComputedStyle(el);
                  return rect.width > 40 && rect.height > 40 && st.display !== 'none' && st.visibility !== 'hidden';
                };
                const sels = [
                  '.chat-layout__workspace .el-scrollbar__wrap',
                  '.chat__content .el-scrollbar__wrap',
                  '.chat .el-scrollbar__wrap',
                  '.chat-layout__workspace',
                  '.image-chat-page .chat-layout__main',
                  '.chat__content',
                ];
                for (const sel of sels) {
                  const el = document.querySelector(sel);
                  if (el && visible(el) && el.scrollHeight > el.clientHeight + 12) {
                    el.scrollTop = Math.min(el.scrollTop + delta, el.scrollHeight);
                    return;
                  }
                }
                window.scrollBy(0, delta);
            }""",
            px,
        )
    except Exception:
        try:
            page.mouse.wheel(0, px)
        except Exception:
            pass


def _syntx_download_scope(page):
    """Prefer the main chat column so we do not hit header/sidebar Save/Download."""
    for sel in (".chat-layout__workspace", ".chat .chat__content", ".chat__content"):
        loc = page.locator(sel).first
        try:
            if loc.count() > 0 and loc.is_visible(timeout=800):
                return loc
        except Exception:
            continue
    return page.locator(".image-chat-page").first


def smart_try_download_click(page, job: dict) -> bool:
    """Click Download / Скачать scoped to the chat column (avoids unrelated toolbar buttons)."""
    scope = _syntx_download_scope(page)
    custom = env_for_model(job, "DOWNLOAD_SELECTOR", "").strip()
    if custom:
        try:
            loc = page.locator(custom).first
            if loc.is_visible(timeout=3000):
                loc.click(force=True, timeout=5000)
                return True
        except Exception:
            pass

    for label in ("Download", "Скачать", "скачать"):
        try:
            scope.get_by_text(label, exact=False).last.click(timeout=4000, force=True)
            return True
        except Exception:
            continue

    for sel in (
        "a[download]",
        "button[aria-label*='ownload']",
        "a[aria-label*='ownload']",
        "[class*='download']",
    ):
        try:
            loc = scope.locator(sel).last
            if loc.count() == 0:
                continue
            if loc.is_visible(timeout=2000):
                loc.click(force=True, timeout=5000)
                return True
        except Exception:
            continue

    try:
        page.locator(".chat-layout__workspace a[download], .chat__content a[download]").last.click(
            force=True, timeout=4000
        )
        return True
    except Exception:
        pass

    return smart_click_by_candidates(
        page,
        ["Download", "Скачать", "скач"],
        selector=".chat-layout__workspace a, .chat-layout__workspace button, .chat__content a, .chat__content button",
        timeout_ms=3500,
    )


def syntx_result_image_visible(page) -> bool:
    """True when the chat shows a large assistant image (download is usually below it)."""
    try:
        return bool(
            page.evaluate(
                """() => {
                    const visible = (el) => {
                      if (!el) return false;
                      const rect = el.getBoundingClientRect();
                      const st = window.getComputedStyle(el);
                      return rect.width > 48 && rect.height > 48 && st.display !== 'none' && st.visibility !== 'hidden';
                    };
                    const imgs = Array.from(
                      document.querySelectorAll('.chat-layout__workspace img, .chat__content img')
                    ).filter(visible);
                    return imgs.some((img) => {
                      const nw = img.naturalWidth || 0;
                      const nh = img.naturalHeight || 0;
                      const r = img.getBoundingClientRect();
                      if (r.width > 220 && r.height > 220) return true;
                      return nw > 160 && nh > 160 && r.width > 64 && r.height > 64;
                    });
                }"""
            )
        )
    except Exception:
        return False


def wait_syntx_chat_result_ready(page, job: dict) -> None:
    """After generate, wait until a full-size image appears (or timeout), scrolling meanwhile."""
    timeout_ms = int(os.environ.get("SYNTX_RESULT_READY_TIMEOUT_MS", str(5 * 60 * 1000)))
    poll_ms = max(350, int(os.environ.get("SYNTX_RESULT_READY_POLL_MS", "800")))
    settle_ms = max(0, int(os.environ.get("SYNTX_POST_GENERATE_SETTLE_MS", "2000")))
    syntx_safe_page_wait(page, settle_ms)
    if syntx_result_image_visible(page):
        print("Syntx smart: result image already visible after generate (skipping long wait)")
        return
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if syntx_result_image_visible(page):
            print("Syntx smart: result image visible in chat")
            return
        syntx_scroll_chat_toward_bottom(page)
        syntx_safe_page_wait(page, poll_ms)
    print("Syntx smart: result image not detected in time (still trying download)")


def smart_download_result(page, job: dict, download_dir: Path) -> Path:
    wait_syntx_chat_result_ready(page, job)
    timeout_ms = int(os.environ.get("SYNTX_TIMEOUT_MS", str(30 * 60 * 1000)))
    deadline = time.time() + timeout_ms / 1000
    last_error: Exception | None = None
    scroll_steps = max(1, int(os.environ.get("SYNTX_DOWNLOAD_SCROLL_STEPS", "6")))
    scroll_steps_fast = max(1, int(os.environ.get("SYNTX_DOWNLOAD_SCROLL_STEPS_FAST", "2")))
    poll_ms = max(250, int(os.environ.get("SYNTX_DOWNLOAD_POLL_MS", "600")))
    expect_ms = max(3000, int(os.environ.get("SYNTX_DOWNLOAD_EXPECT_MS", "12000")))
    first_expect_ms = max(
        expect_ms,
        int(os.environ.get("SYNTX_DOWNLOAD_FIRST_EXPECT_MS", str(max(45000, expect_ms)))),
    )
    attempt = 0

    while time.time() < deadline:
        attempt += 1
        eff_steps = scroll_steps_fast if syntx_result_image_visible(page) else scroll_steps
        for _ in range(eff_steps):
            syntx_scroll_chat_toward_bottom(page)
            syntx_safe_page_wait(page, 120)
        expect_this = first_expect_ms if attempt == 1 else expect_ms
        try:
            with page.expect_download(timeout=expect_this) as download_info:
                if not smart_try_download_click(page, job):
                    try:
                        page.locator("a[download]").first.click(force=True, timeout=3000)
                    except Exception:
                        pass
            download = download_info.value
            ext = ".png" if job.get("model") == "sora-image" else ".mp4"
            filename = download.suggested_filename or f"{job['id']}{ext}"
            output_path = download_dir / filename
            download.save_as(output_path)
            print("Syntx smart: download saved")
            return output_path
        except Exception as exc:
            last_error = exc
            syntx_safe_page_wait(page, poll_ms)

    artifacts = save_debug_artifacts(page, job["id"], "smart-download-timeout")
    raise RuntimeError(f"Syntx smart download did not appear in time. Debug: {artifacts}. Last error: {last_error}")


def run_smart_syntx_job(page, job: dict, download_dir: Path) -> Path:
    if not smart_select_sora_model_version(page, job):
        raise RuntimeError(f"Syntx smart model version was not selected. Visible UI: {visible_ui_summary(page)}")

    if not smart_select_aspect_ratio(page, job):
        raise RuntimeError(f"Syntx smart aspect ratio was not selected. Visible UI: {visible_ui_summary(page)}")

    smart_attach_reference_images(page, job, download_dir)

    if not smart_fill_prompt(page, str(job.get("prompt", ""))):
        artifacts = save_debug_artifacts(page, job["id"], "smart-prompt-not-found")
        raise RuntimeError(f"Syntx smart prompt field not found. Debug: {artifacts}. Visible UI: {visible_ui_summary(page)}")
    print("Syntx smart: inserted prompt")

    smart_click_generate(page, job)
    return smart_download_result(page, job, download_dir)


def run_selector_syntx_job(page, job: dict, download_dir: Path) -> Path:
    prompt_selector = env_for_model(
        job,
        "PROMPT_SELECTOR",
        "textarea, [contenteditable='true'], input[type='text']",
    )
    _gen_default = (
        ".chat-input__actions-right button.ml-2.chat-input__button, "
        "button:has-text('Generate'), button:has-text('Create'), button:has-text('Создать')"
        if job.get("model") == "sora-image"
        else "button:has-text('Generate'), button:has-text('Create'), button:has-text('Создать')"
    )
    generate_selector = env_for_model(job, "GENERATE_SELECTOR", _gen_default)
    download_selector = env_for_model(
        job,
        "DOWNLOAD_SELECTOR",
        (
            "a[download], a:has-text('Download'), button:has-text('Download'), "
            "a:has-text('Скачать'), button:has-text('Скачать')"
            if job.get("model") == "sora-image"
            else "a:has-text('Download'), button:has-text('Download'), a[download]"
        ),
    )
    timeout_ms = int(os.environ.get("SYNTX_TIMEOUT_MS", str(30 * 60 * 1000)))

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

    try:
        gen = page.locator(generate_selector).first
        interval = max(200, int(os.environ.get("SYNTX_GENERATE_CLICK_INTERVAL_MS", "450")))
        burst = max(1, int(os.environ.get("SYNTX_GENERATE_BURST_CLICKS", "12")))
        started = False
        for click_idx in range(1, GENERATE_CLICK_COUNT + 1):
            if job.get("model") == "sora-image" and syntx_result_image_visible(page):
                print("Syntx selector: Sora result image already visible, skipping further generate clicks")
                started = True
                break
            if syntx_generation_in_progress(page):
                print(f"Syntx selector: generation in progress before generate round {click_idx}")
                started = True
                break
            for _ in range(burst):
                gen.click(force=True, timeout=60_000)
                page.wait_for_timeout(80)
                if job.get("model") == "sora-image" and syntx_result_image_visible(page):
                    print("Syntx selector: Sora result visible during generate burst, stopping")
                    started = True
                    break
                if syntx_generation_in_progress(page):
                    print(f"Syntx selector: generation in progress after round {click_idx} (burst)")
                    started = True
                    break
            if started:
                break
            for _ in range(24):
                page.wait_for_timeout(150)
                if job.get("model") == "sora-image" and syntx_result_image_visible(page):
                    print("Syntx selector: Sora result visible while waiting for progress, stopping")
                    started = True
                    break
                if syntx_generation_in_progress(page):
                    print(f"Syntx selector: generation in progress after {click_idx} generate round(s)")
                    started = True
                    break
            if started:
                break
            page.wait_for_timeout(interval)
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "generate-not-found")
        raise RuntimeError(
            f"Syntx generate button not found by selector {generate_selector!r}. "
            f"Debug: {artifacts}"
        ) from exc

    wait_syntx_chat_result_ready(page, job)
    scroll_steps = max(1, int(os.environ.get("SYNTX_DOWNLOAD_SCROLL_STEPS", "6")))
    scroll_steps_fast = max(1, int(os.environ.get("SYNTX_DOWNLOAD_SCROLL_STEPS_FAST", "2")))
    poll_ms = max(250, int(os.environ.get("SYNTX_DOWNLOAD_POLL_MS", "600")))
    expect_ms = max(5000, int(os.environ.get("SYNTX_DOWNLOAD_EXPECT_MS", "25000")))
    first_expect_ms = max(
        expect_ms,
        int(os.environ.get("SYNTX_DOWNLOAD_FIRST_EXPECT_MS", str(max(45000, expect_ms)))),
    )
    download = None
    last_err: Exception | None = None
    deadline_dl = time.time() + timeout_ms / 1000
    attempt_dl = 0
    while time.time() < deadline_dl:
        attempt_dl += 1
        eff_steps = scroll_steps_fast if syntx_result_image_visible(page) else scroll_steps
        for _ in range(eff_steps):
            syntx_scroll_chat_toward_bottom(page)
            page.wait_for_timeout(120)
        expect_this = first_expect_ms if attempt_dl == 1 else expect_ms
        try:
            raw = page.locator(download_selector)
            loc = raw.last if job.get("model") == "sora-image" else raw.first
            loc.wait_for(state="visible", timeout=12_000)
            with page.expect_download(timeout=expect_this) as download_info:
                loc.click(force=True, timeout=15_000)
            download = download_info.value
            break
        except Exception as exc:
            last_err = exc
            page.wait_for_timeout(poll_ms)
    if download is None:
        artifacts = save_debug_artifacts(page, job["id"], "download-timeout")
        raise RuntimeError(
            f"Syntx result download did not appear in time (try scrolling selectors / SYNTX_DOWNLOAD_* env). "
            f"Debug: {artifacts}. Last error: {last_err}"
        ) from last_err

    ext = ".png" if job.get("model") == "sora-image" else ".mp4"
    filename = download.suggested_filename or f"{job['id']}{ext}"
    output_path = download_dir / filename
    download.save_as(output_path)
    return output_path


def run_syntx_job(job: dict, download_dir: Path) -> Path:
    """Run one Syntx job and return downloaded result path.

    Syntx has no public automation API here. The worker first tries smart DOM
    automation, then env selectors, then the optional coordinate profile.
    """
    storage_state = os.environ.get("SYNTX_STORAGE_STATE")
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
        try:
            page.goto(job["targetUrl"], wait_until="domcontentloaded", timeout=60_000)
            print(f"Syntx page: title={page.title()!r} url={page.url!r}")
            wait_for_syntx_app_ready(page, job)
            prepare_syntx_page(page, job)

            errors: list[str] = []
            if SMART_MODE:
                try:
                    return run_smart_syntx_job(page, job, download_dir)
                except Exception as exc:
                    errors.append(f"smart: {exc}")
                    print(f"Syntx smart mode failed, trying selector fallback: {exc}")

            try:
                return run_selector_syntx_job(page, job, download_dir)
            except Exception as exc:
                errors.append(f"selector: {exc}")
                print(f"Syntx selector mode failed, trying coordinate fallback if configured: {exc}")

            coordinate_profile = load_coordinate_profile(job)
            if coordinate_profile:
                try:
                    return run_coordinate_syntx_job(page, job, download_dir, coordinate_profile)
                except Exception as exc:
                    errors.append(f"coordinates: {exc}")

            raise RuntimeError("Syntx automation failed. " + " | ".join(errors))
        finally:
            context.close()
            browser.close()


def process_job(job: dict) -> None:
    job_id = job["id"]
    resolution = job.get("resolution") or "-"
    print(f"claimed {job_id}: {job['model']} {resolution} {job['aspectRatio']}")
    runtime_copy: Path | None = None
    try:
        with tempfile.TemporaryDirectory(prefix="syntx-") as tmp:
            result_path = run_syntx_job(job, Path(tmp))
            runtime_copy = copy_syntx_result_to_repo_runtime(job_id, result_path)
            print(f"Syntx: saved local copy (same layout as app): {runtime_copy}")
            complete_job(job_id, result_path)
            print(f"completed {job_id}: {result_path.name}")
    except Exception as exc:
        print(f"failed {job_id}: {exc}")
        if runtime_copy is not None:
            fname = runtime_copy.name
            print(
                f"Syntx: result file remains at {runtime_copy}. "
                f"If only /complete failed, after Supabase is reachable you can set resultUrl to "
                f"local-generation:{fname} for this generation (or re-run complete)."
            )
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

        auth = (self.headers.get("Authorization", "") or "").strip()
        if not auth.lower().startswith("bearer "):
            self._send_json(403, {"error": "forbidden"})
            return
        bearer = auth[7:].strip() if len(auth) > 7 else ""
        if not bearer_matches_worker_auth(bearer):
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
    assert_worker_tokens_configured()
    server = ThreadingHTTPServer((MANUAL_HOST, MANUAL_PORT), ManualWorkerHandler)
    print(f"Syntx manual worker listening on http://{MANUAL_HOST}:{MANUAL_PORT}/run")
    server.serve_forever()


def main() -> None:
    assert_worker_tokens_configured()
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
