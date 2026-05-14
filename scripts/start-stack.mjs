#!/usr/bin/env node
/**
 * Поднимает Next (`next start`) и Syntx-воркер в одном процессе-родителе.
 * Подхватывает переменные из .env в корне (не перезаписывает уже заданные в shell).
 * По умолчанию SYNTX_MANUAL_SERVER=1 — как у локального PowerShell-запуска.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function resolvePython() {
  const isWin = process.platform === "win32";
  const unixVenv = path.join(root, ".venv", "bin", "python");
  const winVenv = path.join(root, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(unixVenv)) return unixVenv;
  if (fs.existsSync(winVenv)) return winVenv;
  return isWin ? "python" : "python3";
}

loadDotEnv();

if (process.env.SYNTX_MANUAL_SERVER === undefined) {
  process.env.SYNTX_MANUAL_SERVER = "1";
}

const python = resolvePython();
const workerScript = path.join(root, "workers", "syntx_worker.py");

const isWin = process.platform === "win32";
const npxCmd = isWin ? "npx.cmd" : "npx";

const next = spawn(npxCmd, ["next", "start"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: isWin,
});

const worker = spawn(python, [workerScript], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: false,
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    next.kill(signal);
  } catch {
    /* ignore */
  }
  try {
    worker.kill(signal);
  } catch {
    /* ignore */
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

next.on("exit", (code, sig) => {
  if (!shuttingDown) {
    try {
      worker.kill(sig || "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code ?? (sig ? 1 : 0));
});

worker.on("exit", (code, sig) => {
  if (shuttingDown) return;
  if (code !== 0 && code !== null) {
    console.error(`[start-stack] Syntx worker exited with code ${code}`);
    try {
      next.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    process.exit(code);
  }
});
