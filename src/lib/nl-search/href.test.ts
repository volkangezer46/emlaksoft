import { describe, expect, it, vi } from "vitest";
import { nlTargetHref, parseExcludeParam } from "./href";
import { NL_GROUPS, parseNlQuery, type NlGeo } from "./parse";
import { applyPropertyNlFilters, hasPropertyNlFilters, normalizePropertyNlParams, propertyNlUrlParams } from "./property-filters";

const GEO: NlGeo = {
  provinces: [{ id: "11111111-1111-1111-1111-111111111111", name: "İstanbul" }],
  districts: [{ id: "22222222-2222-2222-2222-222222222222", name: "Kadıköy", parentId: "11111111-1111-1111-1111-111111111111" }],
};

describe("nlTargetHref", () => {
  it("portföy: filtreleri filtre kontratı parametreleriyle yazar", () => {
    const r = parseNlQuery("Kadıköy 3+1 satılık 2 milyon altı", GEO);
    const { href, unsupported } = nlTargetHref(r);
    expect(href.startsWith("/app/portfoyler?")).toBe(true);
    const sp = new URLSearchParams(href.split("?")[1]);
    expect(sp.get("islem")).toBe("Satılık");
    expect(sp.get("oda")).toBe("3+1");
    expect(sp.get("fiyat_max")).toBe("2000000");
    expect(sp.get("ilce")).toBe("22222222-2222-2222-2222-222222222222");
    expect(unsupported).toEqual([]);
  });

  it("talep: yalnız il taşınır, diğer chip'ler desteklenmiyor olarak döner", () => {
    const r = parseNlQuery("Kadıköy 3+1 arayan talepler", GEO);
    const { href, unsupported } = nlTargetHref(r);
    expect(href).toBe("/app/talepler?il=11111111-1111-1111-1111-111111111111");
    expect(unsupported.map((c) => c.group)).toEqual(["oda"]);
  });

  it("müşteri: yapılandırılmış filtre yok, anlaşılamayan metin q olur", () => {
    const r = parseNlQuery("ayse yilmaz musteri", GEO);
    const { href } = nlTargetHref(r);
    expect(href).toBe("/app/musteriler?q=ayse+yilmaz");
  });

  it("filtre yoksa çıplak yol", () => {
    expect(nlTargetHref(parseNlQuery("", GEO)).href).toBe("/app/portfoyler");
  });
});

describe("parseExcludeParam", () => {
  it("yalnız bilinen grupları alır", () => {
    expect(parseExcludeParam("fiyat,oda,x", NL_GROUPS)).toEqual(["fiyat", "oda"]);
    expect(parseExcludeParam(undefined, NL_GROUPS)).toEqual([]);
  });
});

describe("normalizePropertyNlParams", () => {
  it("geçersiz değerleri atar", () => {
    const f = normalizePropertyNlParams({
      islem: "Hurda",
      oda: "3+1,abc,2+1",
      fiyat_max: "-5",
      m2_min: "100",
      il: "not-uuid",
      foto: "eksik",
    });
    expect(f.islem).toBeNull();
    expect(f.oda).toEqual(["3+1", "2+1"]);
    expect(f.fiyatMax).toBeNull();
    expect(f.m2Min).toBe(100);
    expect(f.il).toBeNull();
    expect(f.fotoEksik).toBe(true);
    expect(propertyNlUrlParams(f)).toEqual({ oda: "3+1,2+1", m2_min: "100", foto: "eksik" });
    expect(hasPropertyNlFilters(normalizePropertyNlParams({}))).toBe(false);
  });
});

describe("applyPropertyNlFilters", () => {
  it("sunucu sorgusuna doğru kolonlarla iner", () => {
    const calls: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["eq", "in", "gte", "lte"]) {
      q[m] = vi.fn((col: string, val: unknown) => {
        calls.push(`${m}:${col}:${Array.isArray(val) ? val.join("|") : String(val)}`);
        return q;
      });
    }
    applyPropertyNlFilters(
      q,
      normalizePropertyNlParams({ islem: "Kiralık", oda: "2+1", fiyat_min: "10", fiyat_max: "20", m2_min: "50", kat_max: "4" }),
    );
    expect(calls).toEqual([
      "eq:transaction_type:Kiralık",
      "in:features->>rooms:2+1",
      "gte:list_price:10",
      "lte:list_price:20",
      "gte:features->sqm:50",
      "lte:features->floor:4",
    ]);
  });
});
