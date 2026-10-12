import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cron kapsam sözleşmesi (statik): her `src/app/api/cron/<ad>/route.ts`
 *  - `authorizeCron` ile CRON_SECRET Bearer doğrular,
 *  - `recordHeartbeat` yazar (izlenebilirlik),
 *  - hata sarmalına sahiptir: `guardCron` | `runCronSteps` | `try {`.
 * Davranış (401/503/5xx + heartbeat adı) `cron-contract.test.ts`'de; burada yalnız yeni route'un bu üç kapıyı atlamadığı korunur.
 */
const ROOT = process.cwd();
const CRON_DIR = join(ROOT, "src/app/api/cron");

/** Gerekçeli istisnalar (yol -> gerekçe). Boş başlar; eklemek için gerekçe şart. */
const EXCEPTIONS: Record<string, string> = {};

const routes = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(CRON_DIR, d.name, "route.ts")))
  .map((d) => d.name)
  .sort();

describe("cron kapsam sözleşmesi", () => {
  it("cron route'ları bulunur", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("istisna listesindeki her giriş gerekçeli ve gerçek bir route'tur", () => {
    for (const [name, reason] of Object.entries(EXCEPTIONS)) {
      expect(routes, name).toContain(name);
      expect(reason.trim().length, name).toBeGreaterThan(10);
    }
  });

  for (const name of routes) {
    it(`${name}: authorizeCron + recordHeartbeat + hata sarmalı`, () => {
      if (EXCEPTIONS[name]) return;
      const src = readFileSync(join(CRON_DIR, name, "route.ts"), "utf8");
      expect(src, "authorizeCron yok").toContain("authorizeCron");
      expect(src, "recordHeartbeat yok").toContain("recordHeartbeat");
      expect(/guardCron|runCronSteps|try \{/.test(src), "guardCron | runCronSteps | try { yok").toBe(true);
    });
  }
});
