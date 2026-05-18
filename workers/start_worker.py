#!/usr/bin/env python3
"""Syntx worker launcher: load .env, checks, friendly console messages."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKERS = Path(__file__).resolve().parent
ENV_FILE = ROOT / ".env"
SETUP_BAT = "setup-syntx-worker.bat"
START_BAT = "start-syntx-worker.bat"
LOGIN_BAT = "syntx-login.bat"


def _title(msg: str) -> None:
    print()
    print("=" * 60)
    print(msg)
    print("=" * 60)


def load_env_file(path: Path, *, override: bool = False) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        if not override and key in os.environ:
            continue
        os.environ[key] = value


def _token_ok() -> bool:
    token = (
        os.environ.get("SYNTX_WORKER_TOKEN")
        or os.environ.get("AUTOMATION_WORKER_TOKEN")
        or ""
    ).strip()
    if not token:
        return False
    lowered = token.lower()
    placeholders = ("replace", "your-site", "paste-", "insert-")
    return not any(p in lowered for p in placeholders)


def validate_config() -> list[str]:
    errors: list[str] = []
    if not ENV_FILE.is_file():
        errors.append(f"Missing {ENV_FILE.name} in the project folder.")
        errors.append(f"  Run {SETUP_BAT} or copy workers\\env.worker.example to .env")
        return errors

    load_env_file(ENV_FILE, override=True)

    site = (os.environ.get("SITE_BASE_URL") or "").strip()
    if not site or "your-site" in site.lower():
        errors.append("Set SITE_BASE_URL in .env (https://your-domain.com).")

    if not _token_ok():
        errors.append(
            "Set AUTOMATION_WORKER_TOKEN in .env (same value as on the web server)."
        )

    manual = (os.environ.get("SYNTX_MANUAL_SERVER") or "0").strip().lower()
    if manual in ("1", "true", "yes", "on"):
        errors.append(
            "Disable SYNTX_MANUAL_SERVER in .env (remove the line or set 0). "
            "Poll mode is required for normal operation."
        )

    return errors


def storage_path() -> Path:
    raw = os.environ.get("SYNTX_STORAGE_STATE", "workers/syntx_storage_state.json").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = ROOT / path
    return path


def check_dependencies() -> list[str]:
    errors: list[str] = []
    try:
        import playwright  # noqa: F401
    except ImportError:
        errors.append(f"Playwright not installed. Run {SETUP_BAT}.")
    try:
        import requests  # noqa: F401
    except ImportError:
        errors.append(f"requests not installed. Run {SETUP_BAT}.")
    return errors


def run_login() -> int:
    load_env_file(ENV_FILE, override=True)
    os.chdir(ROOT)
    _title("Syntx login")
    print("A browser window will open. Log in to Syntx.")
    print("When done, return here and press Enter.")
    print()
    return subprocess.call([sys.executable, str(WORKERS / "syntx_login.py")])


def run_setup_check() -> int:
    _title("Environment check")
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    print(f"Project: {ROOT}")
    dep_errors = check_dependencies()
    cfg_errors = validate_config() if ENV_FILE.is_file() else []
    if not ENV_FILE.is_file():
        cfg_errors = [f"No {ENV_FILE.name} yet - run {SETUP_BAT} to create it."]

    sp = storage_path()
    session_ok = "yes" if sp.is_file() else "no - run login first"
    print(f"Syntx session file: {sp} ({session_ok})")

    all_errors = dep_errors + cfg_errors
    if all_errors:
        print()
        print("Fix these:")
        for item in all_errors:
            print(f"  - {item}")
        return 1

    print()
    print(f"Ready. Run {START_BAT} to start the worker.")
    return 0


def run_worker() -> int:
    os.chdir(ROOT)

    dep_errors = check_dependencies()
    if dep_errors:
        _title("Missing dependencies")
        for item in dep_errors:
            print(item)
        print()
        print(f"Run: {SETUP_BAT}")
        return 1

    cfg_errors = validate_config()
    if cfg_errors:
        _title("Configuration error")
        for item in cfg_errors:
            print(item)
        print()
        print("Edit .env in the project folder or ask your developer for values.")
        return 1

    session = storage_path()
    if not session.is_file():
        _title("Login required")
        print(f"Session file not found: {session}")
        print()
        print(f"Run: {LOGIN_BAT}")
        print(f"Then run: {START_BAT}")
        return 1

    site = os.environ["SITE_BASE_URL"].rstrip("/")
    _title("Syntx worker running")
    print(f"Site: {site}")
    print("Keep this window open. Jobs from the site run automatically.")
    print("Stop: close the window or press Ctrl+C.")
    print()

    sys.path.insert(0, str(WORKERS))
    from syntx_worker import main as worker_main

    try:
        worker_main()
    except KeyboardInterrupt:
        print()
        print("Worker stopped.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Syntx worker launcher")
    parser.add_argument("--login", action="store_true", help="Log in to Syntx and save session")
    parser.add_argument("--setup-check", action="store_true", help="Verify installation")
    args = parser.parse_args()

    if args.login:
        return run_login()
    if args.setup_check:
        return run_setup_check()
    return run_worker()


if __name__ == "__main__":
    raise SystemExit(main())
