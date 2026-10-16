import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PostgREST sorgu kurucusu (`supabase.from(...).select(...)...`) yalnız `then` taşıyan bir thenable'dır; `.catch` / `.finally`
 * YOKTUR. Kurucuyu `as Promise<T>` diye tip zorlayıp `.catch` çağırmak derlemede geçer, çalışırken "….catch is not a function"
 * atar ve sayfayı düşürür (canlı olay 2026-10-17: yönetim ana ekranı KPI satırı). Kural: önce `Promise.resolve(kurucu)`.
 */
const ROOT = join(process.cwd(), "src/app/app/_home");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe("PostgREST kurucusunda doğrudan .catch yok", () => {
  it("`(kurucu as unknown as Promise<T>).catch(` deseni ana ekran kodunda geçmez", () => {
    const bad = files(ROOT).flatMap((p) => {
      const src = readFileSync(p, "utf8");
      return src
        .split("\n")
        .filter((line) => /as\s+(?:unknown\s+as\s+)?Promise<[^>]+>\)\s*\.catch\(/.test(line) && !line.includes("Promise.resolve("))
        .map((line) => `${p}: ${line.trim()}`);
    });
    expect(bad).toEqual([]);
  });
});
