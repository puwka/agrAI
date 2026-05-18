import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SYNTX_URL = "https://syntx.ai/video/veo3"
_raw_state = os.environ.get("SYNTX_STORAGE_STATE", "workers/syntx_storage_state.json")
STATE_PATH = Path(_raw_state)
if not STATE_PATH.is_absolute():
    STATE_PATH = ROOT / STATE_PATH


def main() -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(SYNTX_URL, wait_until="domcontentloaded", timeout=60_000)

        print("")
        print("Log in to Syntx in the browser window.")
        print(f"When done, open or wait for: {SYNTX_URL}")
        input("Press Enter here after you are logged in...")

        context.storage_state(path=str(STATE_PATH))
        print(f"Syntx session saved: {STATE_PATH}")
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
