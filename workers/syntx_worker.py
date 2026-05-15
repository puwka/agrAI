import json
import mimetypes
import os
import re
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


POLL_INTERVAL_SEC = int(os.environ.get("SYNTX_POLL_INTERVAL_SEC", "2"))
# По умолчанию — окно браузера (логин в Syntx на ПК). В CI / без дисплея задайте SYNTX_HEADLESS=1.
_ci = os.environ.get("CI", "").strip().lower() in ("1", "true", "yes")
_DEFAULT_SYNTX_HEADLESS = "1" if _ci else "0"
HEADLESS = os.environ.get("SYNTX_HEADLESS", _DEFAULT_SYNTX_HEADLESS) != "0"
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
HTTP.trust_env = os.environ.get("SYNTX_REQUESTS_TRUST_ENV", "0") == "1"


def syntx_claim_http_timeout() -> tuple[float, float]:
    """(connect, read) for polling jobs — read default выше, т.к. VPS/Supabase иногда отвечает медленно."""
    conn = max(5.0, float(os.environ.get("SYNTX_HTTP_CONNECT_TIMEOUT_SEC", "20")))
    read = max(30.0, float(os.environ.get("SYNTX_CLAIM_READ_TIMEOUT_SEC", "120")))
    return (conn, read)


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


def claim_poll_retries() -> int:
    return max(1, int(os.environ.get("SYNTX_CLAIM_POLL_RETRIES", "4")))


def claim_job() -> dict | None:
    url = f"{SITE_BASE_URL}/api/internal/syntx/jobs"
    last_status: int | None = None
    last_snippet = ""
    for attempt in range(1, claim_poll_retries() + 1):
        try:
            response = HTTP.post(url, headers=api_headers(), timeout=syntx_claim_http_timeout())
        except requests.exceptions.RequestException as exc:
            print(
                f"Syntx: jobs poll failed {url!r} ({attempt}/{claim_poll_retries()}): {exc!s}; "
                f"retry in {POLL_INTERVAL_SEC}s"
            )
            if attempt < claim_poll_retries():
                time.sleep(min(POLL_INTERVAL_SEC, 2))
                continue
            return None

        last_status = response.status_code
        last_snippet = (response.text or "")[:400]

        if response.status_code == 200:
            try:
                payload = response.json()
            except ValueError as exc:
                print(f"Syntx: jobs poll invalid JSON: {exc}; retry in {POLL_INTERVAL_SEC}s")
                return None
            job = payload.get("job")
            if job:
                return job
            err = (payload.get("error") or "").strip()
            if err:
                print(f"Syntx: jobs poll ok but no job: {err[:300]!r}; retry in {POLL_INTERVAL_SEC}s")
            return None

        if response.status_code in (502, 503, 504, 500) and attempt < claim_poll_retries():
            retry_after = response.headers.get("Retry-After", "").strip()
            wait_sec = POLL_INTERVAL_SEC
            if retry_after.isdigit():
                wait_sec = max(1, min(int(retry_after), 30))
            print(
                f"Syntx: jobs poll HTTP {response.status_code} {last_snippet!r} "
                f"({attempt}/{claim_poll_retries()}), retry in {wait_sec}s"
            )
            time.sleep(wait_sec)
            continue

        print(f"Syntx: jobs poll HTTP {response.status_code} {last_snippet!r}; retry in {POLL_INTERVAL_SEC}s")
        return None

    if last_status is not None:
        print(f"Syntx: jobs poll gave up after HTTP {last_status} {last_snippet!r}; retry in {POLL_INTERVAL_SEC}s")
    return None


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


def is_sora_job(job: dict) -> bool:
    return job.get("model") == "sora-image"


def is_veo_job(job: dict) -> bool:
    return job.get("model") == "veo-3.1-relax"


def veo_resolution_label(job: dict) -> str:
    """Как у Syntx в настройках Veo: без явного поля стоит 720p, не 1080p."""
    res = str(job.get("resolution") or "720p").strip().lower()
    return res if res in ("720p", "1080p") else "720p"


def veo_quality_targets(wanted: str) -> list[str]:
    """Только нужное разрешение — нельзя передавать и 720 и 1080 в одном списке (кликнет не тот)."""
    w = wanted if wanted in ("720p", "1080p") else "720p"
    if w == "720p":
        return ["720p", "720P", "720 p", "720", "HD 720", "hd720"]
    return ["1080p", "1080P", "1080 p", "1080", "Full HD", "FullHD", "FHD", "UHD"]


def veo_read_quality_section_value(page) -> str | None:
    """Текущее качество в открытой секции Quality: '720p' | '1080p' | None."""
    try:
        v = page.evaluate(
            """() => {
                const items = Array.from(document.querySelectorAll('.el-collapse-item'));
                for (const item of items) {
                    const h = item.querySelector('.el-collapse-item__header');
                    if (!h || !/quality/i.test(h.innerText || h.textContent || '')) continue;
                    const wrap = item.querySelector('.el-collapse-item__wrap');
                    if (!wrap) return null;
                    const txt = (wrap.innerText || wrap.textContent || '').replace(/\\s+/g, ' ').trim();

                    const checkedLabel = wrap.querySelector('.el-radio.is-checked .el-radio__label')
                        || wrap.querySelector('.el-radio.is-checked');
                    if (checkedLabel) {
                        const t = (checkedLabel.innerText || checkedLabel.textContent || '').toLowerCase();
                        if (t.includes('1080') || t.includes('full') || t.includes('fhd')) return '1080p';
                        if (t.includes('720')) return '720p';
                    }
                    const inp = wrap.querySelector('input[type="radio"]:checked');
                    if (inp) {
                        const id = inp.id;
                        let lab = null;
                        if (id) lab = document.querySelector(`label[for="${id.replace(/"/g, '')}"]`);
                        if (!lab) lab = inp.closest('label');
                        const t = ((lab && (lab.innerText || lab.textContent)) || inp.value || '').toLowerCase();
                        if (t.includes('1080') || String(inp.value || '').includes('1080')) return '1080p';
                        if (t.includes('720') || String(inp.value || '').includes('720')) return '720p';
                    }
                    const seg = wrap.querySelector(
                        '.el-segmented__item.is-selected, .el-segmented__item.is-active, ' +
                        '.el-segmented-item.is-selected, [class*="segmented"] [class*="selected"]'
                    );
                    if (seg) {
                        const t = (seg.innerText || '').toLowerCase();
                        if (t.includes('1080') || t.includes('full')) return '1080p';
                        if (t.includes('720')) return '720p';
                    }
                    const segItems = Array.from(
                        wrap.querySelectorAll('.el-segmented__item, .el-segmented-item, [class*="segmented__item"]')
                    );
                    const marked = segItems.some((el) =>
                        /is-selected|is-active|selected|active/i.test(el.className || '')
                    );
                    if (segItems.length >= 2 && !marked) {
                        const texts = segItems.map((el) => (el.innerText || el.textContent || '').toLowerCase());
                        const has720 = texts.some((t) => /720/.test(t));
                        const has1080 = texts.some((t) => /1080|full|fhd/.test(t));
                        if (has720 && has1080 && texts[0] && /720/.test(texts[0])) return '720p';
                    }
                    const selTxt = wrap.querySelector('.el-select .el-select__selected-item, .el-select__placeholder');
                    if (selTxt) {
                        const st = (selTxt.innerText || selTxt.textContent || '').toLowerCase();
                        if (st.includes('1080') || st.includes('full') || st.includes('fhd')) return '1080p';
                        if (st.includes('720')) return '720p';
                    }
                    const low = txt.toLowerCase();
                    if (/1080\\s*p|full\\s*hd|\\bfhd\\b|\\buhd\\b/i.test(low)) return '1080p';
                    if (/720\\s*p/i.test(low)) return '720p';
                    return null;
                }
                return null;
            }"""
        )
        return v if v in ("720p", "1080p") else None
    except Exception:
        return None


def veo_skip_model_picker() -> bool:
    """На /video/veo3 модель уже Veo — не трогаем «Model selection» (иначе уходит в Kling)."""
    return os.environ.get("SYNTX_VEO_SKIP_MODEL_PICK", "1") != "0"


def veo_resolution_optional() -> bool:
    """Не падать, если Quality/720p/1080p не нашлись (на странице Veo чаще уже 720p)."""
    return os.environ.get("SYNTX_VEO_RESOLUTION_OPTIONAL", "1") != "0"


def veo_wants_image_mode(job: dict) -> bool:
    mode = str(job.get("inputMode") or "TEXT").strip().upper()
    if mode == "IMAGE_REF":
        return True
    return bool(job.get("referenceImages"))


def veo_mode_option_labels(job: dict) -> list[str]:
    if veo_wants_image_mode(job):
        return [
            "Image to Video",
            "Images to Video",
            "Image To Video",
            "Image-to-Video",
            "Frames to Video",
        ]
    return ["Text to Video", "Text To Video", "Text-to-Video"]


def veo_mode_current_labels(job: dict) -> list[str]:
    """Если режим уже выбран — не кликать повторно."""
    return veo_mode_option_labels(job)


def syntx_requires_auth(page) -> bool:
    try:
        if page.evaluate(
            """() => !!(
                document.querySelector("[data-cy='telegram-login-btn']") ||
                document.querySelector("[data-cy='google-login-btn']") ||
                document.querySelector(".auth-page")
            )"""
        ):
            return True
    except Exception:
        pass
    url = (page.url or "").lower()
    title = (page.title() or "").lower()
    return "/auth" in url or "/login" in url or "войти" in title or "login" in title


def assert_syntx_authenticated(page, job: dict) -> None:
    if not syntx_requires_auth(page):
        return
    artifacts = save_debug_artifacts(page, job["id"], "auth-required")
    state = os.environ.get("SYNTX_STORAGE_STATE", "workers/syntx_storage_state.json")
    raise RuntimeError(
        "Syntx: требуется вход в аккаунт. Выполните: python workers/syntx_login.py "
        f"и задайте SYNTX_STORAGE_STATE={state!r}. Debug: {artifacts}"
    )


def click_syntx_sora_version_dropdown(page) -> bool:
    """Open the Sora *version* dropdown (second small el-select under #teleport-ai-select)."""
    return open_teleport_el_select_small_with_feedback(page, 1)


def click_syntx_veo_model_dropdown(page, job: dict) -> bool:
    """Open the Veo model dropdown (first small el-select under #teleport-ai-select by default)."""
    trigger_index_raw = env_for_model(job, "MODEL_TRIGGER_INDEX", "0")
    try:
        trigger_index = max(0, int(trigger_index_raw))
    except ValueError:
        trigger_index = 0
    return open_teleport_el_select_small_with_feedback(page, trigger_index)


def click_syntx_veo_resolution_dropdown(page, job: dict) -> bool:
    """Open the Veo resolution/quality dropdown (often the second small el-select)."""
    trigger_index_raw = env_for_model(job, "RESOLUTION_TRIGGER_INDEX", "1")
    try:
        trigger_index = max(0, int(trigger_index_raw))
    except ValueError:
        trigger_index = 1
    return open_teleport_el_select_small_with_feedback(page, trigger_index)


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
    assert_syntx_authenticated(page, job)
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
    if is_veo_job(job) and veo_skip_model_picker():
        print("Syntx: Veo page — не открываем панель выбора нейросети (модель уже задана URL)")
    else:
        open_syntx_chat_settings(page)


def run_coordinate_syntx_job(page, job: dict, download_dir: Path, profile: dict) -> Path:
    if is_veo_job(job) and veo_skip_model_picker():
        print("Syntx coordinates: Veo — пропуск кликов по выбору модели")
    else:
        click_point(page, profile, "model_version_trigger")
        page.wait_for_timeout(500)
        click_point(page, profile, "model_first_option")
        page.wait_for_timeout(500)
        print("Syntx coordinates: selected model version")

    if is_veo_job(job):
        res = veo_resolution_label(job)
        res_options = profile.get("resolution_options") if isinstance(profile.get("resolution_options"), dict) else {}
        if point(profile, "resolution_trigger") and res in res_options:
            click_point(page, profile, "resolution_trigger")
            page.wait_for_timeout(500)
            p = res_options[res]
            page.mouse.click(float(p["x"]), float(p["y"]))
            page.wait_for_timeout(500)
            print(f"Syntx coordinates: selected Veo resolution {res}")

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
        if syntx_generation_in_progress(page, job):
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
            ext = ".png" if is_sora_job(job) else ".mp4"
            filename = download.suggested_filename or f"{job['id']}{ext}"
            output_path = download_dir / filename
            download.save_as(output_path)
            return output_path
        except Exception as exc:
            last_error = exc
            page.wait_for_timeout(5000)

    raise RuntimeError(f"Syntx download did not start from coordinate. Last error: {last_error}")


def select_first_syntx_model(page, job: dict) -> None:
    """Select model version on Syntx (Sora version dropdown). Veo: пропуск — страница уже /video/veo3."""

    if not is_sora_job(job) and not is_veo_job(job):
        return

    if is_veo_job(job) and veo_skip_model_picker():
        print("Syntx: Veo — выбор нейросети пропущен (страница уже с Veo)")
        return

    open_syntx_chat_settings(page)

    if is_veo_job(job):
        trigger_index_raw = env_for_model(job, "MODEL_TRIGGER_INDEX", "0")
    else:
        # Sora: first dropdown = family, second = version ("GPT Image 1").
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
            opened = (
                click_syntx_veo_model_dropdown(page, job)
                if is_veo_job(job)
                else click_syntx_sora_version_dropdown(page)
            )
            if not opened:
                raise RuntimeError("model version dropdown did not open (combobox stayed collapsed)")

        picked = False
        veo_labels = ["Veo 3.1 Relax", "Veo 3.1", "Relax", "veo 3.1"]
        for _ in range(ui_click_retries()):
            try:
                if is_veo_job(job):
                    for label in veo_labels:
                        try:
                            page.locator(first_model_selector).filter(has_text=label).first.click(
                                force=True, timeout=3000
                            )
                            picked = True
                            break
                        except Exception:
                            continue
                if not picked:
                    page.locator(first_model_selector).first.click(force=True, timeout=5000)
                page.wait_for_timeout(450)
                picked = True
                break
            except Exception:
                if trigger_selector:
                    page.locator(trigger_selector).nth(trigger_index).click(force=True, timeout=5000)
                elif is_veo_job(job):
                    if not click_syntx_veo_model_dropdown(page, job):
                        break
                elif not open_teleport_el_select_small_with_feedback(page, trigger_index):
                    break
                page.wait_for_timeout(ui_click_interval_ms())
        if not picked:
            raise RuntimeError("first model option click did not succeed")
        print("Syntx: selected model version")
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "first-model-not-selected")
        model_key = str(job.get("model", "")).upper().replace("-", "_")
        raise RuntimeError(
            f"Syntx first model version was not selected. "
            f"Set SYNTX_{model_key}_MODEL_TRIGGER_SELECTOR / SYNTX_{model_key}_MODEL_TRIGGER_INDEX / "
            f"SYNTX_{model_key}_FIRST_MODEL_SELECTOR. "
            f"Debug: {artifacts}"
        ) from exc


def expand_syntx_veo_sidebar_section(page, labels: list[str]) -> bool:
    """Раскрыть блок Format / Quality в правой панели Veo (не «Model selection»)."""
    if expand_syntx_veo_collapse_section(page, labels):
        return True
    header_selector = (
        "button, [role='button'], .el-collapse-item__header, "
        "[class*='collapse-item__header'], [class*='settings'] h3, [class*='settings'] h4"
    )
    for label in labels:
        if smart_click_by_candidates(page, [label], selector=header_selector, timeout_ms=2500):
            page.wait_for_timeout(450)
            return True
    return False


def expand_syntx_veo_collapse_section(page, keywords: list[str]) -> bool:
    """Раскрыть секцию правой панели Veo (UI на англ.: Additional / Format / Quality)."""
    try:
        header = page.locator(".el-collapse-item__header").filter(
            has_text=re.compile("|".join(re.escape(k) for k in keywords), re.I)
        ).first
        if header.count() > 0:
            header.scroll_into_view_if_needed(timeout=5000)
            item = header.locator("xpath=ancestor::*[contains(@class,'el-collapse-item')][1]")
            try:
                active = item.evaluate(
                    "el => el.classList.contains('is-active') || "
                    "el.querySelector('.el-collapse-item__header')?.getAttribute('aria-expanded') === 'true'"
                )
            except Exception:
                active = False
            if not active:
                header.click(force=True, timeout=5000)
            syntx_safe_page_wait(page, 500)
            return True
    except Exception:
        pass

    try:
        opened = page.evaluate(
            """(keywords) => {
                const keys = keywords.map((k) => String(k).toLowerCase());
                const items = Array.from(document.querySelectorAll('.el-collapse-item'));
                for (const item of items) {
                    const header = item.querySelector('.el-collapse-item__header');
                    const text = (header?.innerText || header?.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                    if (!keys.some((k) => text === k || text.includes(k))) continue;
                    const active =
                        item.classList.contains('is-active') ||
                        header?.getAttribute('aria-expanded') === 'true';
                    if (!active && header) {
                        header.scrollIntoView({ block: 'center', inline: 'nearest' });
                        header.click();
                    }
                    return true;
                }
                return false;
            }""",
            keywords,
        )
        if opened:
            syntx_safe_page_wait(page, 500)
            return True
    except Exception:
        pass
    return False


def expand_syntx_veo_collapse_by_index(page, index: int) -> bool:
    """Additional=0, Format=1, Quality=2 на странице Veo."""
    try:
        ok = page.evaluate(
            """(index) => {
                const items = Array.from(document.querySelectorAll('.el-collapse-item'));
                const item = items[index];
                if (!item) return false;
                const header = item.querySelector('.el-collapse-item__header');
                const active =
                    item.classList.contains('is-active') ||
                    header?.getAttribute('aria-expanded') === 'true';
                if (!active && header) {
                    header.scrollIntoView({ block: 'center', inline: 'nearest' });
                    header.click();
                }
                return true;
            }""",
            index,
        )
        if ok:
            syntx_safe_page_wait(page, 500)
            return True
    except Exception:
        pass
    return False


def syntx_veo_collapse_panel(page, keywords: list[str]):
    """Локатор содержимого раскрытой секции (Формат / Качество)."""
    pattern = re.compile("|".join(re.escape(k) for k in keywords), re.I)
    item = page.locator(".el-collapse-item").filter(
        has=page.locator(".el-collapse-item__header").filter(has_text=pattern)
    ).first
    return item.locator(".el-collapse-item__wrap").first


def expand_syntx_veo_format_section(page) -> bool:
    if expand_syntx_veo_collapse_section(page, ["format"]):
        print("Syntx: expanded Format section")
        return True
    if expand_syntx_veo_collapse_by_index(page, 1):
        print("Syntx: expanded Format section (index 1)")
        return True
    return False


def _syntx_veo_quality_scroll_js(page, extra: int, max_steps: int) -> None:
    try:
        page.evaluate(
            """({ extraPx, maxSteps }) => {
                const items = Array.from(document.querySelectorAll('.el-collapse-item'));
                let wrap = null;
                for (const item of items) {
                    const h = item.querySelector('.el-collapse-item__header');
                    if (!h || !/quality/i.test((h.innerText || h.textContent || ''))) continue;
                    wrap = item.querySelector('.el-collapse-item__wrap');
                    break;
                }
                if (!wrap) return;

                const scrollableY = (el) => {
                    if (!el || el === document.body || el === document.documentElement) return false;
                    const st = window.getComputedStyle(el);
                    const oy = st.overflowY;
                    return (
                        (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
                        el.scrollHeight > el.clientHeight + 4
                    );
                };

                const resolutionish = () => {
                    const cand = Array.from(
                        wrap.querySelectorAll(
                            '.el-segmented__item, .el-segmented-item, .el-radio, label, .el-select__wrapper, span, button'
                        )
                    );
                    const hit = cand.find((n) => /720|1080/.test((n.innerText || n.textContent || '')));
                    return (
                        hit ||
                        wrap.querySelector('.el-segmented, .el-radio, .el-select__wrapper, [role="radiogroup"]') ||
                        wrap
                    );
                };

                const rectInView = (inner, outer) => {
                    const ir = inner.getBoundingClientRect();
                    const or = outer.getBoundingClientRect();
                    if (ir.height < 2 || or.height < 2) return false;
                    return ir.top >= or.top - 1 && ir.bottom <= or.bottom + 1;
                };

                const collect = () => {
                    const out = new Set();
                    let p = wrap;
                    for (let i = 0; i < 32 && p; i++) {
                        if (scrollableY(p)) out.add(p);
                        p = p.parentElement;
                    }
                    document.querySelectorAll(
                        '.el-scrollbar__wrap, .el-scrollbar__view, [data-overlayscrollbars-viewport], .os-viewport'
                    ).forEach((el) => {
                        if (el.contains(wrap) && scrollableY(el)) out.add(el);
                    });
                    return Array.from(out).sort(
                        (a, b) =>
                            (b.clientHeight || 0) - (a.clientHeight || 0) ||
                            (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
                    );
                };

                wrap.scrollIntoView({ block: 'end', inline: 'nearest' });

                for (const sc of collect()) {
                    let stale = 0;
                    for (let step = 0; step < maxSteps; step++) {
                        const ce = resolutionish();
                        ce.scrollIntoView({ block: 'center', inline: 'nearest' });
                        if (rectInView(ce, sc)) break;
                        const fr = ce.getBoundingClientRect();
                        const sr = sc.getBoundingClientRect();
                        const before = sc.scrollTop;
                        if (fr.bottom > sr.bottom - 6) {
                            const d = Math.min(
                                fr.bottom - sr.bottom + extraPx,
                                sc.scrollHeight - sc.clientHeight - sc.scrollTop
                            );
                            if (d > 0.5) sc.scrollTop += d;
                        } else if (fr.top < sr.top + 6) {
                            const d = Math.min(sr.top + 6 - fr.top + extraPx, sc.scrollTop);
                            if (d > 0.5) sc.scrollTop -= d;
                        }
                        if (Math.abs(sc.scrollTop - before) < 0.5) {
                            stale++;
                            if (stale > 2) break;
                        } else stale = 0;
                    }
                }

                let p = wrap;
                for (let i = 0; i < 32 && p; i++) {
                    if (scrollableY(p)) {
                        const max = Math.max(0, p.scrollHeight - p.clientHeight);
                        p.scrollTop = Math.min(p.scrollTop + 360 + extraPx, max);
                    }
                    p = p.parentElement;
                }
                resolutionish().scrollIntoView({ block: 'center', inline: 'nearest' });
            }""",
            {"extraPx": max(0, extra), "maxSteps": max_steps},
        )
    except Exception:
        pass


def _syntx_veo_settings_panel_wheel(page, wheel_delta: int, wheel_steps: int) -> None:
    custom = os.environ.get("SYNTX_VEO_SETTINGS_SCROLL_SELECTOR", "").strip()
    selectors = [s.strip() for s in custom.split(",") if s.strip()] if custom else []
    selectors.extend(
        [
            "#teleport-ai-select .el-scrollbar__wrap",
            "#teleport-ai-select .el-scrollbar__view",
            ".video-chat-page #teleport-ai-select .el-scrollbar__wrap",
            ".route-video-ai #teleport-ai-select .el-scrollbar__wrap",
            ".video-chat-page .chat-layout__workspace ~ aside .el-scrollbar__wrap",
            ".video-chat-page aside .el-scrollbar__wrap",
        ]
    )
    seen: set[str] = set()
    for sel in selectors:
        if sel in seen:
            continue
        seen.add(sel)
        try:
            loc = page.locator(sel).first
            if loc.count() == 0:
                continue
            if not loc.is_visible(timeout=900):
                continue
            box = loc.bounding_box()
            if not box or box.get("width", 0) < 40:
                continue
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + min(120, box["height"] / 2))
            loc.click(force=True, timeout=2500)
            page.wait_for_timeout(80)
            for _ in range(max(1, wheel_steps)):
                page.mouse.wheel(0, wheel_delta)
                page.wait_for_timeout(42)
            for _ in range(7):
                page.keyboard.press("PageDown")
                page.wait_for_timeout(35)
            print(f"Syntx: wheel/PageDown on settings scroll ({sel})")
            return
        except Exception:
            continue


def scroll_syntx_veo_quality_into_view(page, *, use_wheel: bool = True) -> None:
    """Правая панель Veo: Quality (720p/1080p) под внутренним скроллом Element Plus."""
    extra = int(os.environ.get("SYNTX_VEO_QUALITY_SCROLL_EXTRA_PX", "120") or "120")
    max_steps = int(os.environ.get("SYNTX_VEO_QUALITY_SCROLL_MAX_STEPS", "55") or "55")
    wheel_delta = int(os.environ.get("SYNTX_VEO_QUALITY_WHEEL_DELTA", "420") or "420")
    wheel_steps = int(os.environ.get("SYNTX_VEO_QUALITY_WHEEL_STEPS", "16") or "16")
    max_steps = max(5, min(max_steps, 120))
    _syntx_veo_quality_scroll_js(page, extra, max_steps)
    print("Syntx: scrolled Quality controls (JS scrollTop / scrollIntoView)")
    if use_wheel and os.environ.get("SYNTX_VEO_QUALITY_SCROLL_WHEEL", "1") != "0":
        _syntx_veo_settings_panel_wheel(page, wheel_delta, wheel_steps)


def expand_syntx_veo_quality_section(page) -> bool:
    """3rd accordion «Quality» — Open all + раскрытие, пока контент не виден."""

    def quality_body_visible() -> bool:
        try:
            return bool(
                page.evaluate(
                    """() => {
                        const items = Array.from(document.querySelectorAll('.el-collapse-item'));
                        for (const item of items) {
                            const h = item.querySelector('.el-collapse-item__header');
                            if (!h || !/quality/i.test((h.innerText || h.textContent || ''))) continue;
                            if (!item.classList.contains('is-active')) return false;
                            const wrap = item.querySelector('.el-collapse-item__wrap');
                            if (!wrap) return false;
                            const inner = wrap.querySelector('.el-collapse-item__content');
                            const hgt = inner ? inner.getBoundingClientRect().height : wrap.getBoundingClientRect().height;
                            return hgt > 6;
                        }
                        return false;
                    }"""
                )
            )
        except Exception:
            return False

    def click_open_all() -> None:
        for pat in (r"Open\s+all", r"Открыть\s+все", r"Open\s+All"):
            try:
                page.locator("button, [role='button'], a").filter(has_text=re.compile(pat, re.I)).first.click(
                    force=True, timeout=3500
                )
                syntx_safe_page_wait(page, 550)
                print("Syntx: clicked Open all (sidebar)")
                return
            except Exception:
                continue

    for round_idx in range(2):
        if round_idx == 1:
            click_open_all()

        if expand_syntx_veo_collapse_section(page, ["quality"]):
            print("Syntx: expanded Quality section (header match)")
        elif expand_syntx_veo_collapse_by_index(page, 2):
            print("Syntx: expanded Quality section (index 2)")
        else:
            try:
                page.locator(".el-collapse-item__header").filter(has_text=re.compile(r"^Quality\s*$", re.I)).click(
                    force=True, timeout=5000
                )
                syntx_safe_page_wait(page, 500)
                print("Syntx: expanded Quality section (exact header)")
            except Exception:
                pass

        if quality_body_visible():
            print("Syntx: Quality panel body is visible")
            scroll_syntx_veo_quality_into_view(page, use_wheel=False)
            syntx_safe_page_wait(page, 250)
            return True

        try:
            page.evaluate(
                """() => {
                    const items = Array.from(document.querySelectorAll('.el-collapse-item'));
                    for (const item of items) {
                        const h = item.querySelector('.el-collapse-item__header');
                        if (!h || !/quality/i.test((h.innerText || h.textContent || ''))) continue;
                        h.scrollIntoView({ block: 'center', inline: 'nearest' });
                        h.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        return true;
                    }
                    return false;
                }"""
            )
            syntx_safe_page_wait(page, 450)
        except Exception:
            pass

        if quality_body_visible():
            scroll_syntx_veo_quality_into_view(page, use_wheel=False)
            syntx_safe_page_wait(page, 250)
            return True

    return False


def syntx_confirm_images_settings_modal(page, attempts: int = 18) -> bool:
    """После загрузки референса в 9:16 — модалка «Images settings» с Confirm."""
    title_pat = re.compile(r"Images?\s+settings|Настройк.*изображен", re.I)
    btn_pat = re.compile(r"^Confirm$|^Подтвердить$", re.I)

    for _ in range(max(1, attempts)):
        try:
            dlg = page.locator(".el-dialog.el-dialog--center:visible, .el-overlay-dialog .el-dialog:visible").filter(
                has_text=title_pat
            )
            if dlg.count() == 0:
                dlg = page.get_by_role("dialog").filter(has_text=title_pat)
            if dlg.count() == 0:
                dlg = page.locator(".el-dialog:visible").filter(
                    has_text=re.compile(r"Aspect\s+ratio|Images?\s+settings", re.I)
                ).filter(has_text=re.compile(r"Confirm", re.I))
            if dlg.count() > 0 and dlg.first.is_visible(timeout=600):
                scope = dlg.first
                for sel in (
                    scope.get_by_role("button", name=btn_pat),
                    scope.locator("button.el-button--primary").filter(has_text=btn_pat),
                    scope.locator("button").filter(has_text=re.compile(r"Confirm|Подтвердить", re.I)),
                ):
                    try:
                        btn = sel.first
                        if btn.count() > 0:
                            btn.click(force=True, timeout=4000)
                            syntx_safe_page_wait(page, 600)
                            print("Syntx: confirmed Images settings modal")
                            return True
                    except Exception:
                        continue
                try:
                    clicked = scope.evaluate(
                        """(el) => {
                            const root = el || document;
                            const btns = root.querySelectorAll('button, .el-button');
                            for (const b of btns) {
                                const t = (b.innerText || '').trim();
                                if (/^confirm$/i.test(t) || /^подтвердить$/i.test(t)) {
                                    b.click();
                                    return true;
                                }
                            }
                            return false;
                        }"""
                    )
                    if clicked:
                        syntx_safe_page_wait(page, 600)
                        print("Syntx: confirmed Images settings modal (JS)")
                        return True
                except Exception:
                    pass
        except Exception:
            pass
        syntx_safe_page_wait(page, 400)
    return False


def pick_veo_quality_resolution(page, panel, targets: list[str]) -> bool:
    """720p или 1080p в секции Quality: segmented, radio, select — targets только нужное разрешение."""
    extra = int(os.environ.get("SYNTX_VEO_QUALITY_SCROLL_EXTRA_PX", "120") or "120")
    max_steps = max(5, min(int(os.environ.get("SYNTX_VEO_QUALITY_SCROLL_MAX_STEPS", "55") or "55"), 120))
    _syntx_veo_quality_scroll_js(page, max(0, extra), max_steps)
    syntx_safe_page_wait(page, 220)
    if not targets:
        return False

    def try_click(locator) -> bool:
        try:
            if locator.count() == 0:
                return False
            locator.first.click(force=True, timeout=5000)
            syntx_safe_page_wait(page, 400)
            return True
        except Exception:
            return False

    for lb in targets:
        pat = re.compile(re.escape(lb), re.I)
        for sel in (
            ".el-segmented__item",
            ".el-segmented-item",
            "[class*='segmented__item']",
            ".el-radio",
            "label.el-radio",
            "button",
            "[role='radio']",
        ):
            if try_click(panel.locator(sel).filter(has_text=pat)):
                return True

    for lb in targets:
        try:
            rad = panel.locator(".el-radio").filter(has_text=re.compile(re.escape(lb), re.I)).first
            if rad.count() > 0:
                rad.click(force=True, timeout=5000)
                syntx_safe_page_wait(page, 350)
                return True
        except Exception:
            pass
        try:
            lab = panel.locator("label.el-radio, label").filter(has_text=re.compile(re.escape(lb), re.I)).first
            if lab.count() > 0:
                lab.click(force=True, timeout=5000)
                syntx_safe_page_wait(page, 350)
                return True
        except Exception:
            pass

    wrap = panel.locator(".el-select__wrapper").first
    if wrap.count() > 0 and wrap.is_visible(timeout=1500):
        try:
            wrap.click(force=True, timeout=4000)
            syntx_safe_page_wait(page, 350)
            dropdown = page.locator(".el-select-dropdown:visible").last
            for lb in targets:
                try:
                    dropdown.locator(".el-select-dropdown__item").filter(
                        has_text=re.compile(re.escape(lb), re.I)
                    ).first.click(force=True, timeout=4000)
                    syntx_safe_page_wait(page, 350)
                    return True
                except Exception:
                    continue
        except Exception:
            pass

    try:
        ok = page.evaluate(
            """({ labels }) => {
                const norm = (s) => String(s || '').toLowerCase().replace(/\\s+/g, '');
                const wants = labels.map(norm).filter(Boolean);
                const pick = (root, el) => {
                    const t = norm(el.innerText || el.textContent || '');
                    return wants.some((w) => w && (t.includes(w) || w.includes(t)));
                };
                const items = Array.from(document.querySelectorAll('.el-collapse-item'));
                let wrap = null;
                for (const item of items) {
                    const h = item.querySelector('.el-collapse-item__header');
                    if (!h || !/quality/i.test((h.innerText || h.textContent || ''))) continue;
                    wrap = item.querySelector('.el-collapse-item__wrap');
                    break;
                }
                if (!wrap) return false;
                for (const sel of wrap.querySelectorAll('.el-segmented__item, .el-segmented-item, button, .el-radio, label.el-radio')) {
                    if (!pick(wrap, sel)) continue;
                    sel.scrollIntoView({ block: 'center', inline: 'nearest' });
                    sel.click();
                    return true;
                }
                const radios = wrap.querySelectorAll('.el-radio, label.el-radio');
                for (const r of radios) {
                    const t = norm(r.innerText || '');
                    if (!t) continue;
                    if (wants.some((w) => w && (t.includes(w) || w.includes(t)))) {
                        r.click();
                        return true;
                    }
                }
                const wrapEl = wrap.querySelector('.el-select__wrapper');
                if (wrapEl) {
                    wrapEl.click();
                    return true;
                }
                return false;
            }""",
            {"labels": targets},
        )
        if ok:
            syntx_safe_page_wait(page, 450)
            if page.locator(".el-select-dropdown:visible").count() > 0:
                dropdown = page.locator(".el-select-dropdown:visible").last
                for lb in targets:
                    try:
                        dropdown.locator(".el-select-dropdown__item").filter(
                            has_text=re.compile(re.escape(lb), re.I)
                        ).first.click(force=True, timeout=4000)
                        syntx_safe_page_wait(page, 350)
                        return True
                    except Exception:
                        continue
            return True
    except Exception:
        pass

    return pick_option_in_veo_panel(page, panel, targets)


def syntx_veo_mode_select_wrapper(page):
    """Dropdown «Mode» (Text to Video / Image to Video) в правой панели."""
    try:
        row = page.locator(".el-form-item, [class*='form-item'], [class*='settings']").filter(
            has_text=re.compile(r"^\s*Mode\s*$", re.I)
        )
        wrap = row.locator(".el-select__wrapper").first
        if wrap.count() > 0:
            return wrap
    except Exception:
        pass
    try:
        wrap = page.locator(".el-select__wrapper").filter(
            has_text=re.compile(r"Text to Video|Image to Video", re.I)
        ).first
        if wrap.count() > 0:
            return wrap
    except Exception:
        pass
    return page.locator(".el-select__wrapper").first


def veo_mode_already_selected(page, job: dict) -> bool:
    want = veo_mode_option_labels(job)
    try:
        wrap = syntx_veo_mode_select_wrapper(page)
        text = (wrap.inner_text(timeout=2000) or "").lower()
        return any(label.lower() in text for label in want)
    except Exception:
        return False


def smart_select_veo_mode(page, job: dict) -> bool:
    if not is_veo_job(job):
        return True

    targets = veo_mode_option_labels(job)
    if veo_mode_already_selected(page, job):
        print(f"Syntx smart: Veo Mode already set ({targets[0]})")
        return True

    custom_trigger = env_for_model(job, "MODE_TRIGGER_SELECTOR", "").strip()
    try:
        if custom_trigger:
            page.locator(custom_trigger).first.locator(".el-select__wrapper").click(force=True, timeout=5000)
        else:
            wrap = syntx_veo_mode_select_wrapper(page)
            wrap.scroll_into_view_if_needed(timeout=5000)
            wrap.click(force=True, timeout=5000)
        syntx_safe_page_wait(page, 400)
        dropdown = page.locator(".el-select-dropdown:visible").last
        for label in targets:
            try:
                dropdown.get_by_text(label, exact=False).first.click(timeout=5000, force=True)
                syntx_safe_page_wait(page, 400)
                print(f"Syntx smart: selected Veo Mode «{label}»")
                return True
            except Exception:
                continue
        if smart_click_by_candidates(
            page,
            targets,
            selector=".el-select-dropdown__item, [role='option'], li",
            timeout_ms=5000,
        ):
            print(f"Syntx smart: selected Veo Mode ({targets[0]})")
            return True
    except Exception:
        pass

    if smart_select_option(page, ["Mode"], targets, timeout_ms=6000):
        print(f"Syntx smart: selected Veo Mode via menu ({targets[0]})")
        return True
    return False


def select_syntx_veo_mode(page, job: dict) -> None:
    if not is_veo_job(job):
        return
    if smart_select_veo_mode(page, job):
        return
    targets = veo_mode_option_labels(job)
    artifacts = save_debug_artifacts(page, job["id"], "veo-mode-not-selected")
    raise RuntimeError(
        f"Syntx Veo Mode was not selected (wanted {targets[0]!r}). "
        f"Set SYNTX_VEO_3_1_RELAX_MODE_TRIGGER_SELECTOR. Debug: {artifacts}"
    )


def pick_option_in_veo_panel(page, panel, labels: list[str]) -> bool:
    """Выбрать пункт в dropdown внутри панели Формат/Качество."""
    for label in labels:
        try:
            panel.get_by_text(label, exact=False).first.click(timeout=2500, force=True)
            syntx_safe_page_wait(page, 400)
            return True
        except Exception:
            continue

    try:
        wrappers = panel.locator(".el-select__wrapper")
        count = wrappers.count()
        for idx in range(count):
            try:
                wrappers.nth(idx).click(force=True, timeout=4000)
                syntx_safe_page_wait(page, 350)
            except Exception:
                continue
            dropdown = page.locator(".el-select-dropdown:visible").last
            for label in labels:
                try:
                    dropdown.get_by_text(label, exact=False).first.click(timeout=3000, force=True)
                    syntx_safe_page_wait(page, 400)
                    return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


def select_syntx_veo_resolution(page, job: dict) -> None:
    if not is_veo_job(job):
        return
    if smart_select_veo_resolution(page, job):
        return
    res = veo_resolution_label(job)
    if veo_resolution_optional():
        print(f"Syntx: Veo resolution {res} not changed (optional, using page default)")
        return
    artifacts = save_debug_artifacts(page, job["id"], "veo-resolution-not-selected")
    raise RuntimeError(
        f"Syntx Veo resolution {res} was not selected. "
        f"Set SYNTX_VEO_3_1_RELAX_RESOLUTION_TRIGGER_SELECTOR or SYNTX_VEO_RESOLUTION_{res.upper()}_SELECTOR. "
        f"Debug: {artifacts}"
    )


def select_syntx_aspect_ratio(page, job: dict) -> None:
    trigger_selector = env_for_model(job, "ASPECT_TRIGGER_SELECTOR", "")
    aspect = str(job.get("aspectRatio", "")).strip()
    if not aspect:
        return

    if is_veo_job(job) and not trigger_selector:
        if smart_select_veo_aspect_ratio(page, job):
            return

    if not trigger_selector and (is_sora_job(job) or is_veo_job(job)):
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
        syntx_confirm_images_settings_modal(page)
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "reference-not-attached")
        model_key = str(job.get("model", "")).upper().replace("-", "_")
        raise RuntimeError(
            f"Syntx reference images were not attached. Set SYNTX_{model_key}_REFERENCE_UPLOAD_SELECTOR. "
            f"Debug: {artifacts}"
        ) from exc


def smart_select_sora_model_version(page, job: dict) -> bool:
    if not is_sora_job(job):
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


def smart_select_veo_model_version(page, job: dict) -> bool:
    if not is_veo_job(job):
        return True
    if veo_skip_model_picker():
        print("Syntx smart: Veo — выбор нейросети пропущен (страница /video/veo3)")
        return True

    try:
        open_syntx_chat_settings(page)
        if not click_syntx_veo_model_dropdown(page, job):
            return False
        page.wait_for_timeout(500)
        if smart_click_by_candidates(
            page,
            ["Veo 3.1 Relax", "Veo 3.1", "Relax", "veo 3.1", "veo"],
            selector=".el-select-dropdown__item, [role='option'], li, button, [role='button']",
            timeout_ms=5000,
        ):
            print("Syntx smart: selected Veo 3.1 Relax model")
            return True
        option = page.locator(".el-select-dropdown__item:not(.is-disabled), [role='option']:not([aria-disabled='true'])").first
        option.click(timeout=5000)
        page.wait_for_timeout(500)
        print("Syntx smart: selected first visible Veo model option")
        return True
    except Exception:
        return False


def smart_select_veo_resolution(page, job: dict) -> bool:
    if not is_veo_job(job):
        return True

    res = veo_resolution_label(job)
    targets = veo_quality_targets(res)
    try:
        custom_trigger = env_for_model(job, "RESOLUTION_TRIGGER_SELECTOR", "").strip()
        if custom_trigger:
            page.locator(custom_trigger).first.locator(".el-select__wrapper").click(force=True, timeout=5000)
            page.wait_for_timeout(400)
            if smart_click_by_candidates(
                page,
                targets,
                selector=".el-select-dropdown__item, [role='option'], li",
                timeout_ms=5000,
            ):
                print(f"Syntx smart: selected Veo quality {res} (env trigger)")
                return True

        if not expand_syntx_veo_quality_section(page):
            print("Syntx: could not expand Quality section")
            return False

        syntx_safe_page_wait(page, 450)

        scroll_syntx_veo_quality_into_view(page)
        syntx_safe_page_wait(page, 280)

        current = veo_read_quality_section_value(page)
        if current == res:
            print(f"Syntx smart: Veo quality already {res}")
            return True

        panel = syntx_veo_collapse_panel(page, ["Quality"])
        try:
            if panel.count() > 0:
                panel.wait_for(state="visible", timeout=5000)
                if pick_veo_quality_resolution(page, panel, targets):
                    print(f"Syntx smart: selected Veo quality {res} (Quality section)")
                    return True
        except Exception:
            pass

        active_item = page.locator(".el-collapse-item.is-active").filter(
            has=page.locator(".el-collapse-item__header").filter(has_text=re.compile(r"Quality|Качество", re.I))
        )
        wrap = active_item.locator(".el-collapse-item__wrap").first
        if wrap.count() > 0 and pick_veo_quality_resolution(page, wrap, targets):
            print(f"Syntx smart: selected Veo quality {res} (active Quality panel)")
            return True

        if smart_click_by_candidates(
            page,
            targets,
            selector=".el-collapse-item.is-active .el-select-dropdown__item, "
            ".el-collapse-item.is-active [role='option'], "
            ".el-collapse-item.is-active .el-radio, "
            ".el-collapse-item.is-active label.el-radio, "
            ".el-collapse-item.is-active .el-segmented__item, "
            ".el-collapse-item.is-active .el-segmented-item",
            timeout_ms=5000,
        ):
            print(f"Syntx smart: selected Veo quality {res} (scoped)")
            return True

        if veo_read_quality_section_value(page) == res:
            print(f"Syntx smart: Veo quality now {res} (after scoped click)")
            return True
    except Exception:
        return False
    return False


def smart_select_model_version(page, job: dict) -> bool:
    if is_sora_job(job):
        return smart_select_sora_model_version(page, job)
    if is_veo_job(job):
        return smart_select_veo_model_version(page, job)
    return True


def smart_select_veo_aspect_ratio(page, job: dict) -> bool:
    aspect = str(job.get("aspectRatio", "")).strip()
    if not aspect or not is_veo_job(job):
        return True

    aspect_labels = [aspect, aspect.replace(":", " : "), aspect.replace(":", "/")]
    try:
        if not expand_syntx_veo_format_section(page):
            print("Syntx: could not expand Format section")
        else:
            print("Syntx: expanded Format section")

        panel = syntx_veo_collapse_panel(page, ["Format"])
        try:
            if panel.count() > 0:
                for trigger_label in ["Aspect ratio", "Aspect Ratio", "Aspect"]:
                    try:
                        row = panel.locator(".el-select").filter(has_text=trigger_label).first
                        if row.count() > 0:
                            row.locator(".el-select__wrapper").click(force=True, timeout=4000)
                            syntx_safe_page_wait(page, 350)
                            if pick_option_in_veo_panel(page, page.locator(".el-select-dropdown:visible").last, aspect_labels):
                                print(f"Syntx smart: selected Veo aspect {aspect} (Формат → соотношение)")
                                return True
                    except Exception:
                        continue
                if pick_option_in_veo_panel(page, panel, aspect_labels):
                    print(f"Syntx smart: selected Veo aspect {aspect} (вкладка «Формат»)")
                    return True
        except Exception:
            pass

        if smart_select_option(
            page,
            ["Aspect ratio", "Соотношение сторон", "Aspect", "Соотношение"],
            aspect_labels,
            timeout_ms=6000,
        ):
            print(f"Syntx smart: selected Veo aspect {aspect} (Format fallback)")
            return True
        trigger = page.locator('[data-cy="aspect-ration-select-menu"]').first
        if trigger.is_visible(timeout=1500):
            if open_aspect_ratio_dropdown_with_feedback(page):
                page.wait_for_timeout(200)
                if smart_click_by_candidates(
                    page,
                    aspect_labels,
                    selector=".el-select-dropdown__item, [role='option'], li",
                    timeout_ms=5000,
                ):
                    print(f"Syntx smart: selected Veo aspect {aspect} (aspect-ration-select-menu)")
                    return True
    except Exception:
        pass
    return False


def smart_select_aspect_ratio(page, job: dict) -> bool:
    aspect = str(job.get("aspectRatio", "")).strip()
    if not aspect:
        return True

    if is_veo_job(job):
        if smart_select_veo_aspect_ratio(page, job):
            return True

    if is_sora_job(job) or is_veo_job(job):
        try:
            trigger = page.locator('[data-cy="aspect-ration-select-menu"]').first
            if trigger.is_visible(timeout=2000):
                if open_aspect_ratio_dropdown_with_feedback(page):
                    page.wait_for_timeout(200)
                    if smart_click_by_candidates(
                        page,
                        [aspect, aspect.replace(":", " : "), aspect.replace(":", "/")],
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
        syntx_confirm_images_settings_modal(page)
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
        syntx_confirm_images_settings_modal(page)
    except Exception as exc:
        artifacts = save_debug_artifacts(page, job["id"], "smart-reference-not-attached")
        raise RuntimeError(f"Syntx smart reference upload failed. Debug: {artifacts}") from exc


def syntx_generation_in_progress(page, job: dict | None = None) -> bool:
    """Heuristic: Syntx started processing (uploading / loading overlay in workspace)."""
    try:
        video_mode = job is not None and is_veo_job(job)
        return bool(
            page.evaluate(
                """(videoMode) => {
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
                      if (videoMode) {
                        const videos = Array.from(root.querySelectorAll('video')).filter(visible);
                        const hasVideo = videos.some((v) => {
                          const r = v.getBoundingClientRect();
                          const dur = Number(v.duration);
                          if (r.width > 200 && r.height > 120 && dur > 0.5) return true;
                          const src = v.currentSrc || v.getAttribute('src') || '';
                          return r.width > 160 && r.height > 90 && src && !src.startsWith('blob:');
                        });
                        if (hasVideo) return false;
                      } else {
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
                }""",
                video_mode,
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
        if syntx_result_ready_visible(page, job):
            print("Syntx smart: result already visible, skipping further generate clicks")
            return
        if syntx_generation_in_progress(page, job):
            print(f"Syntx smart: generation already in progress before generate round {click_idx}")
            return
        for sub in range(burst):
            if smart_try_generate_click(page, job):
                any_clicked = True
            syntx_safe_page_wait(page, 80)
            if syntx_result_ready_visible(page, job):
                print("Syntx smart: result visible during generate burst, stopping")
                return
            if syntx_generation_in_progress(page, job):
                print(f"Syntx smart: generation in progress after round {click_idx}, burst step {sub + 1}")
                return
        for _ in range(24):
            syntx_safe_page_wait(page, 150)
            if syntx_result_ready_visible(page, job):
                print("Syntx smart: result visible while waiting for progress heuristics, stopping")
                return
            if syntx_generation_in_progress(page, job):
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

    if syntx_generation_in_progress(page, job):
        print(f"Syntx smart: generation in progress after {GENERATE_CLICK_COUNT} generate round(s)")
    else:
        print(
            f"Syntx smart: finished {GENERATE_CLICK_COUNT} generate round(s) ({burst} burst clicks each); "
            "no loading/upload heuristic detected (continuing to download wait)"
        )


def syntx_focus_chat_for_scroll(page) -> None:
    """Focus the chat column so wheel / End apply to the message list, not the sidebar."""
    for sel in (
        ".chat-layout__workspace .chat__content",
        ".chat-layout__workspace",
        ".chat .chat__content",
        ".video-chat-page .chat-layout__main",
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
                        '.image-chat-page, .video-chat-page, .chat-layout__workspace, .container.chat-layout__main, .chat .chat__content, .chat__content'
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
                        '.chat-layout__workspace img[src], .chat__content img[src], .image-chat-page .chat img[src], .video-chat-page .chat img[src]'
                      )
                    ).filter(visible);
                    if (imgs.length) {
                      imgs[imgs.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
                      moved = true;
                    }
                    const videos = Array.from(
                      document.querySelectorAll(
                        '.chat-layout__workspace video, .chat__content video, .video-chat-page video'
                      )
                    ).filter(visible);
                    if (videos.length) {
                      videos[videos.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });
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
        ".video-chat-page .chat-layout__main",
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
                  '.video-chat-page .chat-layout__main',
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
    for sel in (".video-chat-page", ".image-chat-page"):
        loc = page.locator(sel).first
        try:
            if loc.count() > 0 and loc.is_visible(timeout=800):
                return loc
        except Exception:
            continue
    return page.locator("body").first


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


def syntx_result_video_visible(page) -> bool:
    """True when the chat shows a playable/generated video clip."""
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
                    const videos = Array.from(
                      document.querySelectorAll('.chat-layout__workspace video, .chat__content video, .video-chat-page video')
                    ).filter(visible);
                    return videos.some((v) => {
                      const r = v.getBoundingClientRect();
                      const dur = Number(v.duration);
                      if (r.width > 200 && r.height > 120 && dur > 0.5) return true;
                      const src = v.currentSrc || v.getAttribute('src') || '';
                      return r.width > 160 && r.height > 90 && !!src;
                    });
                }"""
            )
        )
    except Exception:
        return False


def syntx_result_ready_visible(page, job: dict) -> bool:
    if is_veo_job(job):
        return syntx_result_video_visible(page)
    return syntx_result_image_visible(page)


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
    """After generate, wait until result media appears (image or video), scrolling meanwhile."""
    timeout_ms = int(
        os.environ.get(
            "SYNTX_VEO_RESULT_READY_TIMEOUT_MS" if is_veo_job(job) else "SYNTX_RESULT_READY_TIMEOUT_MS",
            str(10 * 60 * 1000 if is_veo_job(job) else 5 * 60 * 1000),
        )
    )
    poll_ms = max(350, int(os.environ.get("SYNTX_RESULT_READY_POLL_MS", "800")))
    settle_ms = max(0, int(os.environ.get("SYNTX_POST_GENERATE_SETTLE_MS", "2000")))
    kind = "video" if is_veo_job(job) else "image"
    syntx_safe_page_wait(page, settle_ms)
    if syntx_result_ready_visible(page, job):
        print(f"Syntx: result {kind} already visible after generate (skipping long wait)")
        return
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        if syntx_result_ready_visible(page, job):
            print(f"Syntx: result {kind} visible in chat")
            return
        syntx_scroll_chat_toward_bottom(page)
        syntx_safe_page_wait(page, poll_ms)
    print(f"Syntx: result {kind} not detected in time (still trying download)")


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
        eff_steps = scroll_steps_fast if syntx_result_ready_visible(page, job) else scroll_steps
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
    if not smart_select_model_version(page, job):
        raise RuntimeError(f"Syntx smart model version was not selected. Visible UI: {visible_ui_summary(page)}")

    if is_veo_job(job):
        if not smart_select_veo_mode(page, job):
            want = veo_mode_option_labels(job)[0]
            raise RuntimeError(
                f"Syntx smart: Veo Mode was not selected (expected {want!r}). "
                f"Visible UI: {visible_ui_summary(page)}"
            )

    if not smart_select_aspect_ratio(page, job):
        raise RuntimeError(f"Syntx smart aspect ratio was not selected. Visible UI: {visible_ui_summary(page)}")

    if is_veo_job(job):
        if not smart_select_veo_resolution(page, job):
            if veo_resolution_optional():
                print(
                    f"Syntx smart: Veo quality {veo_resolution_label(job)} not set "
                    "(optional — leaving page default)"
                )
            else:
                raise RuntimeError(
                    f"Syntx smart: quality {veo_resolution_label(job)} not set in Quality section. "
                    f"Visible UI: {visible_ui_summary(page)}"
                )

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
    )
    generate_selector = env_for_model(job, "GENERATE_SELECTOR", _gen_default)
    download_selector = env_for_model(
        job,
        "DOWNLOAD_SELECTOR",
        "a[download], a:has-text('Download'), button:has-text('Download'), "
        "a:has-text('Скачать'), button:has-text('Скачать')",
    )
    timeout_ms = int(os.environ.get("SYNTX_TIMEOUT_MS", str(30 * 60 * 1000)))

    select_first_syntx_model(page, job)
    select_syntx_veo_mode(page, job)
    select_syntx_aspect_ratio(page, job)
    select_syntx_veo_resolution(page, job)
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
            if syntx_result_ready_visible(page, job):
                print("Syntx selector: result already visible, skipping further generate clicks")
                started = True
                break
            if syntx_generation_in_progress(page, job):
                print(f"Syntx selector: generation in progress before generate round {click_idx}")
                started = True
                break
            for _ in range(burst):
                gen.click(force=True, timeout=60_000)
                page.wait_for_timeout(80)
                if syntx_result_ready_visible(page, job):
                    print("Syntx selector: result visible during generate burst, stopping")
                    started = True
                    break
                if syntx_generation_in_progress(page, job):
                    print(f"Syntx selector: generation in progress after round {click_idx} (burst)")
                    started = True
                    break
            if started:
                break
            for _ in range(24):
                page.wait_for_timeout(150)
                if syntx_result_ready_visible(page, job):
                    print("Syntx selector: result visible while waiting for progress, stopping")
                    started = True
                    break
                if syntx_generation_in_progress(page, job):
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
        eff_steps = scroll_steps_fast if syntx_result_ready_visible(page, job) else scroll_steps
        for _ in range(eff_steps):
            syntx_scroll_chat_toward_bottom(page)
            page.wait_for_timeout(120)
        expect_this = first_expect_ms if attempt_dl == 1 else expect_ms
        try:
            raw = page.locator(download_selector)
            loc = raw.last
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
    storage_state = os.environ.get("SYNTX_STORAGE_STATE", "workers/syntx_storage_state.json").strip()
    slow_mo_ms = int(os.environ.get("SYNTX_SLOW_MO_MS", "0"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS, slow_mo=slow_mo_ms)
        context_kwargs = {"accept_downloads": True}
        if storage_state and Path(storage_state).exists():
            context_kwargs["storage_state"] = storage_state
        elif storage_state:
            print(f"Syntx: storage state not found ({storage_state}), run workers/syntx_login.py")
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
