# Syntx worker (Windows)

The worker runs on your PC, picks up jobs from the website, and runs them in Syntx in a browser.

## One-time requirements

1. **Python 3.10+** — https://www.python.org/downloads/ (check **Add python.exe to PATH**).
2. Project folder **agrAI**.
3. From your developer: **SITE_BASE_URL** and **AUTOMATION_WORKER_TOKEN** for `.env`.

## Steps

| Step | File (double-click) |
|------|---------------------|
| 1 | `setup-syntx-worker.bat` — install (5–10 min, internet required) |
| 2 | Edit `.env` in Notepad — set URL and token |
| 3 | `syntx-login.bat` — log in to Syntx in the browser, press Enter in the console |
| 4 | `start-syntx-worker.bat` — keep the window open while you need generations |

Cyrillic-named `.bat` files in the repo root call the same English scripts.

## Troubleshooting

- **No .env** — run setup again or copy `workers\env.worker.example` to `.env`.
- **python is not recognized** — reinstall Python with PATH enabled.
- **Session expired** — run `syntx-login.bat` again.
- **Do not set** `SYNTX_MANUAL_SERVER=1` for normal VPS + PC setup.
