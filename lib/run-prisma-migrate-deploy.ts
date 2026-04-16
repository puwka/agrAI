import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * В рантайме Vercel `npx prisma` часто падает (нет npx / не попал в trace).
 * Запускаем тот же CLI, что и `prisma migrate deploy`, через `node` + resolve из `node_modules`.
 */
export function runPrismaMigrateDeploySync(): void {
  const require = createRequire(import.meta.url);
  const cliEntry = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [cliEntry, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}
