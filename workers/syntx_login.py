import os
from pathlib import Path

from playwright.sync_api import sync_playwright


SYNTX_URL = "https://syntx.ai/video/veo3"
STATE_PATH = Path(os.environ.get("SYNTX_STORAGE_STATE", "workers/syntx_storage_state.json"))


def main() -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(SYNTX_URL, wait_until="domcontentloaded", timeout=60_000)

        print("")
        print("В открывшемся окне войдите в Syntx вручную.")
        print(f"После входа откройте/дождитесь страницы {SYNTX_URL}.")
        input("Когда вход выполнен, нажмите Enter здесь в терминале...")

        context.storage_state(path=str(STATE_PATH))
        print(f"Сессия Syntx сохранена: {STATE_PATH}")
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
