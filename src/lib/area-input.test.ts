import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTrDecimal } from "./money-input";
import { isResidentialPropertyType, parseAreaInput } from "./area-input";
import { parsePortalFeatureFields, parsePortalFeatureFieldsDetailed, ignoredFieldsWarning } from "./portal-transfer/features";
import { commissionSummary, parseLooseNumber } from "./form-tabs";

/**
 * B093 — tek Türkçe sayı ayrıştırıcısı. "1.250" → 1250, "" → null, "120 m²" → 120 her ÇAĞRI YERİNDE aynı:
 *  1) portföy oluştur  2) portföy güncelle (parseAreaInput, properties.ts)  3) talep min m² (demands.ts, parseTrDecimal)
 *  4) değerleme (valuations.ts, parseAreaInput)  5) tapu OCR yüzölçümü (property-media.ts, parseTrDecimal)
 *  6) portal ek alanları 'decimal' dalı (parsePortalFeatureFields)  7) form sekmeleri + istemci özeti (parseLooseNumber).
 */
const form = (o: Record<string, string>) => ({ has: (n: string) => n in o, get: (n: string) => o[n] });

const SITES: Record<string, (raw: string) => number | null> = {
  "portföy oluştur/güncelle (parseAreaInput)": (raw) => {
    const r = parseAreaInput(raw, { label: "Brüt m²", propertyType: "Daire" });
    return r.ok ? r.value : NaN;
  },
  "talep min m² (parseTrDecimal)": (raw) => {
    const r = parseTrDecimal(raw, { max: 1_000_000 });
    return r.ok ? r.value : NaN;
  },
  "değerleme (parseAreaInput)": (raw) => {
    const r = parseAreaInput(raw, { label: "m²", propertyType: "Arsa" });
    return r.ok ? r.value : NaN;
  },
  "tapu OCR yüzölçümü (parseTrDecimal, 4 ondalık)": (raw) => {
    const r = parseTrDecimal(raw, { max: 100_000_000, decimals: 4 });
    return r.ok ? r.value : NaN;
  },
  "portal ek alanı brüt m² (decimal dalı)": (raw) => (parsePortalFeatureFields(form({ gross_sqm: raw })).gross_sqm as number | null),
  "form sekmesi (parseLooseNumber)": (raw) => parseLooseNumber(raw),
  "istemci özeti m² birim fiyatı (commissionSummary)": (raw) => {
    const c = commissionSummary("2.500.000", "2", raw);
    return c?.perSqm != null ? Math.round(2_500_000 / c.perSqm) : null;
  },
};

describe("B093: 7 çağrı yeri aynı sonucu verir", () => {
  for (const [site, parse] of Object.entries(SITES)) {
    it(site, () => {
      expect(parse("1.250")).toBe(1250);
      expect(parse("")).toBeNull();
      expect(parse("120 m²")).toBe(120);
      expect(parse("120")).toBe(120);
    });
  }
});

describe("parseTrDecimal", () => {
  it.each([
    ["1.250", 1250],
    ["1.250,5", 1250.5],
    ["1250.5", 1250.5],
    ["1,5", 1.5],
    ["1.5", 1.5],
    ["120 m²", 120],
    ["120m2", 120],
    ["1.500 TL", 1500],
    ["₺1.500", 1500],
    [" 85 ", 85],
  ])("%p → %p", (raw, expected) => {
    expect(parseTrDecimal(raw)).toEqual({ ok: true, value: expected });
  });

  it("boş değer null (asla 0 değil), geçersiz değer ok:false", () => {
    expect(parseTrDecimal("")).toEqual({ ok: true, value: null });
    expect(parseTrDecimal("   ")).toEqual({ ok: true, value: null });
    for (const bad of ["abc", "-5", "1,2,3", "12 daire", "Bahçe katı"]) expect(parseTrDecimal(bad).ok, bad).toBe(false);
    expect(parseTrDecimal("0").ok).toBe(false);
    expect(parseTrDecimal("0", { allowZero: true })).toEqual({ ok: true, value: 0 });
  });
});

describe("parseAreaInput (çekirdek alan)", () => {
  it("geçersiz değer alan adıyla reddedilir", () => {
    const r = parseAreaInput("abc", { label: "Brüt m²", propertyType: "Daire" });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toContain("Brüt m²");
  });
  it("konutta 10 m² altı kabul edilmez (yeni kayıtta sqm<10 konut 0); arsada serbest", () => {
    expect(parseAreaInput("1,25", { label: "m²", propertyType: "Daire" }).ok).toBe(false);
    expect(parseAreaInput("9", { label: "m²", propertyType: "Villa" }).ok).toBe(false);
    expect(parseAreaInput("10", { label: "m²", propertyType: "Daire" })).toEqual({ ok: true, value: 10 });
    expect(parseAreaInput("5", { label: "m²", propertyType: "Arsa" })).toEqual({ ok: true, value: 5 });
    expect(isResidentialPropertyType("Müstakil ev")).toBe(true);
    expect(isResidentialPropertyType("Depo")).toBe(false);
  });
});

describe("portal ek alanları: kayıt sürer, geçersiz değer 'yok sayıldı' uyarısıyla döner", () => {
  it("aidat '1.500' → 1500 (eskiden 1.5); 'abc' → null + uyarı", () => {
    expect(parsePortalFeatureFields(form({ dues: "1.500" })).dues).toBe(1500);
    const d = parsePortalFeatureFieldsDetailed(form({ dues: "abc", net_sqm: "95" }));
    expect(d.values).toEqual({ dues: null, net_sqm: 95 });
    expect(d.ignored).toEqual([{ key: "dues", label: "Aidat (TL)", raw: "abc" }]);
    expect(ignoredFieldsWarning(d.ignored)).toContain('yok sayıldı: Aidat (TL) "abc"');
    expect(ignoredFieldsWarning([])).toBeNull();
  });
});

describe("sunucu çağrı yerleri eski Number(x.replace(',', '.')) m² desenini kullanmaz", () => {
  const FILES = [
    "src/app/actions/properties.ts",
    "src/app/actions/demands.ts",
    "src/app/actions/valuations.ts",
    "src/app/actions/property-media.ts",
    "src/lib/portal-transfer/features.ts",
  ];
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/(?:sqm|Sqm|m2)\w*\s*=\s*[^;\n]*Number\([^;\n]*replace\(",",\s*"\."\)/);
      expect(src).toMatch(/parseTrDecimal|parseAreaInput/);
    });
  }
});
