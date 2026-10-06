import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GOS_REFERENCE_PATTERN, parseDealGosInput } from "./deal-gos";

describe("anlaşma GÖS alanları", () => {
  it("boş alanlar null, geçerli değerler normalize", () => {
    expect(parseDealGosInput("", "")).toEqual({ ok: true, value: { referenceNo: null, titleDeedAt: null } });
    const r = parseDealGosInput("  GOS-2026/000123 ", "2026-12-03T10:30");
    expect(r.ok && r.value.referenceNo).toBe("GOS-2026/000123");
    // TR saati 10:30 = 07:30Z
    expect(r.ok && r.value.titleDeedAt).toBe("2026-12-03T07:30:00.000Z");
  });

  it("biçim dışı referans ve bozuk tarih reddedilir", () => {
    expect(parseDealGosInput("ab", "").ok).toBe(false);
    expect(parseDealGosInput("abc<script>", "").ok).toBe(false);
    expect(parseDealGosInput("", "yarın").ok).toBe(false);
  });

  it("desen migration CHECK'i ile aynı (tek kaynak); para/IBAN kolonu yok", () => {
    const sql = readFileSync("supabase/migrations/20261007000300_deal_gos_fields.sql", "utf8");
    expect(sql).toContain("'^[A-Za-z0-9./ _-]{3,64}$'");
    expect(GOS_REFERENCE_PATTERN.source).toBe("^[A-Za-z0-9./ _-]{3,64}$");
    expect(sql).not.toMatch(/add column if not exists \w*(iban|amount|tutar)/i);
  });
});
