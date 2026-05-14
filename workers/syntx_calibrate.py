import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright


DEFAULT_TARGET_URL = "https://syntx.ai/image/sora-images"
MODEL_KEY = os.environ.get("SYNTX_CALIBRATE_MODEL", "sora-image")
TARGET_URL = os.environ.get("SYNTX_CALIBRATE_URL", DEFAULT_TARGET_URL)
STATE_PATH = os.environ.get("SYNTX_STORAGE_STATE", "workers/syntx_storage_state.json")
COORDS_PATH = Path(os.environ.get("SYNTX_COORDS_FILE", "workers/syntx_coords.json"))
VIEWPORT_WIDTH = int(os.environ.get("SYNTX_VIEWPORT_WIDTH", "1365"))
VIEWPORT_HEIGHT = int(os.environ.get("SYNTX_VIEWPORT_HEIGHT", "768"))
GENERATE_CLICK_COUNT = 10


def wait_until_ready(label: str) -> None:
    while True:
        print("")
        command = input(
            f"Следующий шаг: {label}\n"
            "Enter — записать клик, p — пауза, q — выйти: "
        ).strip().lower()
        if command == "":
            return
        if command == "p":
            input("Пауза. Подготовьте браузер и нажмите Enter, чтобы продолжить...")
            continue
        if command == "q":
            raise KeyboardInterrupt("Калибровка остановлена пользователем")
        print("Неизвестная команда. Используйте Enter, p или q.")


def wait_for_click(page, label: str, replay: bool = False) -> dict[str, float]:
    wait_until_ready(label)
    print("")
    print(f"Кликните в браузере: {label}")
    point = page.evaluate(
        """(label) => new Promise((resolve) => {
            const handler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                document.removeEventListener('click', handler, true);
                resolve({ x: event.clientX, y: event.clientY });
            };
            document.addEventListener('click', handler, true);
        })""",
        label,
    )
    print(f"  saved: x={point['x']}, y={point['y']}")
    if replay:
        page.mouse.click(point["x"], point["y"])
        page.wait_for_timeout(700)
    return {"x": float(point["x"]), "y": float(point["y"])}


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context_kwargs = {"viewport": {"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}}
        if STATE_PATH and Path(STATE_PATH).exists():
            context_kwargs["storage_state"] = STATE_PATH
        context = browser.new_context(**context_kwargs)
        page = context.new_page()
        page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60_000)

        print("")
        print("Открыл Syntx. Подготовьте экран вручную так, как должен работать воркер.")
        print("Важно: не меняйте размер окна после калибровки.")
        input("Когда готовы начать запись кликов, нажмите Enter...")

        profile = {
            "model_version_trigger": wait_for_click(page, "второй dropdown версии модели (например GPT Image 1)", replay=True),
            "model_first_option": wait_for_click(page, "первый пункт в открывшемся списке версий модели", replay=True),
            "aspect_trigger": wait_for_click(page, "dropdown/кнопка соотношения сторон", replay=True),
            "aspect_options": {
                "1:1": wait_for_click(page, "вариант aspect 1:1", replay=True),
            },
            "prompt": wait_for_click(page, "поле ввода промпта", replay=True),
            "generate_clicks": [
                wait_for_click(page, f"кнопка Generate/Создать — клик {index} из {GENERATE_CLICK_COUNT}")
                for index in range(1, GENERATE_CLICK_COUNT + 1)
            ],
            "download": wait_for_click(page, "кнопка Download/скачать готовый результат"),
        }

        if input("Есть кнопка/зона загрузки референса? y/N: ").strip().lower() == "y":
            profile["reference_upload"] = wait_for_click(page, "кнопка/зона загрузки референса")

        existing = {}
        if COORDS_PATH.exists():
            existing = json.loads(COORDS_PATH.read_text(encoding="utf-8"))
        existing[MODEL_KEY] = profile
        COORDS_PATH.parent.mkdir(parents=True, exist_ok=True)
        COORDS_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

        print("")
        print(f"Координаты сохранены: {COORDS_PATH}")
        print(f"Запускайте воркер с: $env:SYNTX_COORDS_FILE=\"{COORDS_PATH}\"")
        context.close()
        browser.close()


if __name__ == "__main__":
    main()
