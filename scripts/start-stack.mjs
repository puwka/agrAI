#!/usr/bin/env node
/**
 * Поднимает Next (`next start`) и Syntx-воркер в одном процессе-родителе.
 * Подхватывает переменные из .env в корне (не перезаписывает уже заданные в shell).
 * По умолчанию SYNTX_MANUAL_SERVER=1 — как у локального PowerShell-запуска.
 *
 * Перед запуском проверяет, что порты Next (PORT / 3000) и manual-воркера свободны,
 * чтобы не поднимать воркер на 8765 и сразу падать из‑за занятого 3000.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
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

/** true = порт свободен (можно bind). */
function isPortFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.unref();
    s.once("error", () => resolve(false));
    s.listen(port, "0.0.0.0", () => {
      s.close(() => resolve(true));
    });
  });
}

function resolvePython() {
  const isWin = process.platform === "win32";
  const unixVenv = path.join(root, ".venv", "bin", "python");
  const winVenv = path.join(root, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(unixVenv)) return unixVenv;
  if (fs.existsSync(winVenv)) return winVenv;
  return isWin ? "python" : "python3";
}

async function main() {
  loadDotEnv();

  if (process.env.SYNTX_MANUAL_SERVER === undefined) {
    process.env.SYNTX_MANUAL_SERVER = "1";
  }

  const nextPort = Number.parseInt(String(process.env.PORT || "3000"), 10);
  if (!Number.isFinite(nextPort) || nextPort < 1 || nextPort > 65535) {
    console.error("[start-stack] Некорректный PORT в .env");
    process.exit(1);
  }

  if (!(await isPortFree(nextPort))) {
    console.error(
      `[start-stack] Порт ${nextPort} занят — Next не сможет стартовать. Останови старый процесс:`,
    );
    console.error(`  sudo ss -tlnp | grep ':${nextPort}'`);
    console.error("  или pm2 / systemd unit для этого приложения.");
    console.error(`  Либо задай в .env другой порт, например PORT=3001 (и proxy на этот порт).`);
    process.exit(1);
  }

  const manual =
    process.env.SYNTX_MANUAL_SERVER !== "0" && String(process.env.SYNTX_MANUAL_SERVER).toLowerCase() !== "false";
  if (manual) {
    const wPort = Number.parseInt(String(process.env.SYNTX_MANUAL_PORT || "8765"), 10);
    if (Number.isFinite(wPort) && wPort >= 1 && wPort <= 65535 && !(await isPortFree(wPort))) {
      console.error(
        `[start-stack] Порт manual-воркера ${wPort} занят. Останови другой syntx_worker или systemd syntx-worker:`,
      );
      console.error(`  sudo ss -tlnp | grep ':${wPort}'`);
      console.error("  Либо SYNTX_MANUAL_PORT=8777 и обнови SYNTX_WORKER_TRIGGER_URL в .env Next.");
      process.exit(1);
    }
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
}

main().catch((err) => {
  console.error("[start-stack]", err);
  process.exit(1);
});
