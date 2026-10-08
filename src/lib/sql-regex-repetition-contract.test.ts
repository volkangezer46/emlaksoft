import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PostgreSQL düzenli ifade tekrar sınırı 255'tir (RE_DUP_MAX). `{1,512}` gibi bir sayı çalışma anında 2201B
 * "invalid repetition count(s)" verir — derleme/oluşturma anında DEĞİL, ifade ilk değerlendirildiğinde (2026-10-08 canlı
 * hata: campaign-delivery cron). Bu sözleşme düzeltme migration'ından (20261008000900) SONRAKİ dosyalarda 255 üstü tekrarı
 * yasaklar; önceki uygulanmış dosyalar forward-only olduğundan değiştirilemez (düzeltmeleri 000900'dadır).
 */
const DIR = join(process.cwd(), "supabase", "migrations");
const FIX = "20261008000900_fix_regex_repetition_limit.sql";
// '…'{n} ya da {m,n} — yalnız SQL dize sabitleri içinde aranır.
const QUANT = /\{(\d+)(?:,(\d*))?\}/g;

function badQuantifiers(sql: string): string[] {
  const out: string[] = [];
  // Yorum satırları (--) taranmaz: açıklamalar örnek olarak geçersiz ifadeyi anabilir.
  const code = sql.replace(/--[^\n]*/g, "");
  for (const lit of code.match(/'(?:[^']|'')*'/g) ?? []) {
    for (const m of lit.matchAll(QUANT)) {
      const lo = Number(m[1]);
      const hi = m[2] ? Number(m[2]) : lo;
      if (lo > 255 || hi > 255) out.push(m[0]);
    }
  }
  return out;
}

describe("SQL düzenli ifade tekrar sınırı (RE_DUP_MAX = 255)", () => {
  it("dedektör geçersiz ve geçerli örnekleri ayırır", () => {
    expect(badQuantifiers("x ~ '^[a-z]{1,512}$'")).toEqual(["{1,512}"]);
    expect(badQuantifiers("x ~ '^(?:[a-z]{1,255})(?:[a-z]{0,255})$'")).toEqual([]);
  });

  it("düzeltmeden sonraki migration'larda 255 üstü tekrar yok", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f >= FIX).sort();
    expect(files[0]).toBe(FIX);
    const offenders = files.flatMap((f) => badQuantifiers(readFileSync(join(DIR, f), "utf8")).map((q) => `${f}: ${q}`));
    expect(offenders).toEqual([]);
  });
});
