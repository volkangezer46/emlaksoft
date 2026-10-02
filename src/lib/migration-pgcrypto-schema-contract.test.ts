import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// pgcrypto Supabase'de `extensions` şemasında durur. `set search_path = public,
// pg_temp` olan fonksiyonlarda (ve bazı DDL bağlamlarında) şemasız `digest()`
// "function digest(...) does not exist" verir. Yeni migration'lar niteler.
// İstisna: canlıda uygulanmış, değiştirilemeyen iki eski dosya; ikisi de
// 20260812000100_qualify_pgcrypto_digest_in_functions.sql ile düzeltildi.

const DIR = "supabase/migrations";
const LEGACY_UNQUALIFIED = new Set([
  "20260802000147_webhook_compliance_hardening.sql",
  "20260810000920_campaign_delivery_compliance.sql",
]);
const FIX_MIGRATION = "20260812000100_qualify_pgcrypto_digest_in_functions.sql";

function codeOnly(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

describe("migration pgcrypto şema sözleşmesi", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

  it("eski istisnalar dışında şemasız digest() yok", () => {
    const offenders = files.filter(
      (f) => !LEGACY_UNQUALIFIED.has(f) && /(?<![.\w])digest\(/.test(codeOnly(readFileSync(join(DIR, f), "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("düzeltme migration'ı var, extensions.digest kullanır ve iki fonksiyonu yeniler", () => {
    expect(files).toContain(FIX_MIGRATION);
    const sql = codeOnly(readFileSync(join(DIR, FIX_MIGRATION), "utf8"));
    expect(sql).toContain("FUNCTION public.rotate_lead_capture_token");
    expect(sql).toContain("FUNCTION public.verify_campaign_recipient_consent");
    expect(sql).not.toMatch(/(?<![.\w])digest\(/);
    expect(sql).toContain("extensions.digest(");
  });
});
