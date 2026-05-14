#!/usr/bin/env bash
# Запуск Syntx-воркера из корня репозитория (удобно для systemd).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY="${ROOT}/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "syntx: нет интерпретатора ${PY}" >&2
  echo "  Создайте venv: cd ${ROOT} && python3 -m venv .venv && .venv/bin/pip install -U pip requests playwright" >&2
  echo "  Затем: .venv/bin/playwright install chromium" >&2
  exit 1
fi

exec "$PY" "${ROOT}/workers/syntx_worker.py"
