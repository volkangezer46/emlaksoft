import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { canMeasure, pathTemplate } from "./scope";

/**
 * SP3 ölçüm sözleşmeleri (statik + saf):
 *  - Tıklama kimliği (gclid/gbraid/wbraid) saklayan HİÇBİR yazma yok: kaynak kodda yalnız yorumda geçebilir,
 *    migration'larda bu adla sütun yok, istemci paketi bu parametreleri okumaz.
 *  - Ölçüm kapsamı: oturumlu alanlar, giriş/şifre akışları, /kayit/tamamla, token'lı portallar sayılmaz.
 *  - Beacon ucu checkRateLimit (DB) kullanmaz; yalnız süreç içi kova.
 */
const ROOT = process.cwd();
const CLICK_ID = /\b(gclid|gbraid|wbraid|fbclid|msclkid)\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|sql)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(relative(ROOT, p).replaceAll("\\", "/"));
  }
  return out;
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|--)/.test(line);

describe("tıklama kimliği saklanmaz (grep sözleşmesi)", () => {
  it("src/** kodunda tıklama kimliği yalnız yorumda geçer", () => {
    const offenders = walk(join(ROOT, "src")).flatMap((f) =>
      readFileSync(join(ROOT, f), "utf8")
        .split("\n")
        .flatMap((line, i) => (CLICK_ID.test(line) && !isComment(line) ? [`${f}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  it("migration'larda tıklama kimliği sütunu yok", () => {
    const offenders = walk(join(ROOT, "supabase/migrations")).flatMap((f) =>
      readFileSync(join(ROOT, f), "utf8")
        .split("\n")
        .flatMap((line, i) => (CLICK_ID.test(line) && !isComment(line) ? [`${f}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  it("signup_attributions yazımı tıklama kimliği alanı taşımaz", () => {
    const store = readFileSync(join(ROOT, "src/lib/growth/store.ts"), "utf8");
    const capture = readFileSync(join(ROOT, "src/lib/growth/capture.ts"), "utf8");
    expect(store).not.toMatch(CLICK_ID);
    expect(capture).not.toMatch(CLICK_ID);
  });
});

describe("ölçüm kapsamı", () => {
  it.each([
    "/app",
    "/app/x",
    "/admin",
    "/admin/site",
    "/api/v",
    "/giris",
    "/giris/dogrulama",
    "/kayit/tamamla",
    "/sifre-yenile",
    "/sifre-sifirla/abc",
    "/auth/callback",
    "/malik-portali/x",
    "/musteri-portali/x",
    "/lead/token",
    "/tavsiye/token",
    "/randevu-al/token",
    "/imza/abc",
    "/odeme-link/abc",
    "/onizleme/x",
    "/r/abcd2345",
    "/p/ortak",
    "/vitrin/ofis/favoriler",
    "/sayfa/AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "//evil.example",
    "fiyatlar",
  ])("%s ölçülmez", (p) => {
    expect(canMeasure(p)).toBe(false);
  });

  it.each([
    ["/", "/"],
    ["/fiyatlar/", "/fiyatlar"],
    ["/kayit?plan=pro", "/kayit"],
    ["/araclar", "/araclar"],
    ["/araclar/kira-artisi", "/araclar/kira-artisi"],
    ["/gizlilik", "/gizlilik"],
    ["/vitrin/ornek-emlak", "/vitrin/[ofis]"],
    ["/vitrin/ornek-emlak/12345", "/vitrin/[ofis]/[ilan]"],
    ["/vitrin/ornek-emlak/degerleme", "/vitrin/[ofis]/degerleme"],
    ["/danisman/ayse-yilmaz", "/danisman/[kisi]"],
    ["/hakkimizda", "/hakkimizda"],
    ["/kampanya/istanbul", "/kampanya/istanbul"],
  ])("%s → %s", (p, tpl) => {
    expect(pathTemplate(p)).toBe(tpl);
  });

  it("beacon ucu DB hız sınırlayıcısını kullanmaz (G4/P6)", () => {
    for (const f of ["src/app/api/v/route.ts", "src/lib/measure/beacon.ts", "src/lib/measure/rate-bucket.ts"]) {
      expect(readFileSync(join(ROOT, f), "utf8")).not.toContain("checkRateLimit(");
    }
  });
});
