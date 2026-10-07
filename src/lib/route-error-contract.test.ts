import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rota hata sınırı sözleşmesi.
 *
 *  - /app ve /admin altındaki her ana modül klasörü (sayfası olan) kendi `error.tsx`'ine sahiptir ve
 *    kanonik `src/components/ui/route-error.tsx` görünümünü modül adıyla çizer (kabuk ayakta kalır).
 *  - Hiçbir hata sınırı ham hata metnini (`error.message`) ekrana basmaz; yalnız `digest` gösterilir.
 *  - Next 16.3 sınır bileşenine `retry` / `reset` verir; `unstable_retry` YOKTUR (çağrılırsa
 *    "Tekrar dene" düğmesi TypeError atar). Bu kalıp yeniden yazılmasın.
 */

const ROOT = process.cwd();
/** Sayfası olsa da kendi sınırı gerekmeyen klasörler (gerekçeli). */
const NO_BOUNDARY: Record<string, string> = {
  "src/app/app/ara": "yalnız route handler (sayfa yok)",
  "src/app/app/modul-kapali": "statik bilgi sayfası; /app sınırı yeterli",
  "src/app/app/askida": "askıya alınmış ofis bilgi sayfası; /app sınırı yeterli",
  "src/app/app/hos-geldin": "tek seferlik karşılama akışı; /app sınırı yeterli",
};

function moduleDirs(base: string): string[] {
  return readdirSync(path.join(ROOT, base))
    .filter((n) => !n.startsWith("_") && !n.startsWith("(") && !n.startsWith("["))
    .map((n) => `${base}/${n}`)
    .filter((rel) => statSync(path.join(ROOT, rel)).isDirectory() && existsSync(path.join(ROOT, rel, "page.tsx")));
}

function allErrorFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) allErrorFiles(p, out);
    else if (n === "error.tsx" || n === "global-error.tsx") out.push(p);
  }
  return out;
}

describe("rota hata sınırı sözleşmesi", () => {
  const modules = [...moduleDirs("src/app/app"), ...moduleDirs("src/app/admin")];

  it("modül listesi geniş", () => {
    expect(modules.length).toBeGreaterThan(70);
  });

  it("her ana modülün kanonik RouteError kullanan error.tsx'i var (modül adıyla)", () => {
    const missing: string[] = [];
    for (const rel of modules) {
      if (NO_BOUNDARY[rel]) continue;
      const file = path.join(ROOT, rel, "error.tsx");
      if (!existsSync(file)) {
        missing.push(`${rel}: error.tsx yok`);
        continue;
      }
      const src = readFileSync(file, "utf8");
      if (!src.startsWith('"use client";')) missing.push(`${rel}: "use client" ilk satır değil`);
      if (!/from "@\/components\/ui\/route-error"/.test(src) || !/<RouteError\b/.test(src)) missing.push(`${rel}: RouteError kullanmıyor`);
      if (!/moduleName="[^"]{2,}"/.test(src)) missing.push(`${rel}: moduleName yok`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("hiçbir hata sınırı ham hata metnini göstermez ve unstable_retry kullanmaz", () => {
    const bad: string[] = [];
    for (const abs of allErrorFiles(path.join(ROOT, "src/app"))) {
      const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
      const src = readFileSync(abs, "utf8");
      if (/unstable_retry/.test(src)) bad.push(`${rel}: unstable_retry (Next 16.3'te yok; retry kullanın)`);
      // JSX içinde {error.message} basılmaz (reportClientError'a gönderim serbest)
      if (/\{\s*error\??\.message\s*\}/.test(src)) bad.push(`${rel}: ham error.message gösteriliyor`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("kanonik görünüm: tekrar dene + ana ekrana dön + hata kimliği, ham metin yok", () => {
    const src = readFileSync(path.join(ROOT, "src/components/ui/route-error.tsx"), "utf8");
    expect(src.startsWith('"use client";')).toBe(true);
    expect(src).toContain("Tekrar dene");
    expect(src).toContain("Ana ekrana dön");
    expect(src).toContain("Hata kimliği");
    expect(src).toContain("error.digest");
    expect(src).toContain("retry ?? reset");
    expect(src).not.toMatch(/\{\s*error\??\.message\s*\}/);
  });
});
