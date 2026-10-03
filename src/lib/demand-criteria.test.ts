import { describe, expect, it } from "vitest";
import {
  DEMAND_FIELD_GROUPS,
  DEMAND_FIELD_NAMES,
  decodeDemandPreviewParam,
  demandValuesFromFormData,
  encodeDemandPreviewParam,
  hasDemandContent,
  isEmptyCriteria,
  isOwnerSideCustomerType,
  parseDemandCriteria,
  parseDemandValues,
} from "./demand-criteria";

describe("parseDemandValues", () => {
  it("temel alanları ve criteria'yı üretir; bütçe kendiliğinden zorunlu olur", () => {
    const r = parseDemandValues({
      transaction_type: "Satılık",
      property_type: "Daire",
      budget_min: "5.000.000",
      budget_max: "7.500.000",
      rooms: "3+1",
      min_sqm: "120",
      max_sqm: "200",
      floor_min: "2",
      heating: "Merkezi",
      feature_tags: "Asansör, Otopark, asansör",
      uses_loan: "1",
      required_keys: "rooms,heating,facade,bogus",
      demand_province_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.columns).toMatchObject({ budget_min: 5_000_000, budget_max: 7_500_000, rooms: "3+1", min_sqm: 120 });
    expect(r.criteria.max_sqm).toBe(200);
    expect(r.criteria.features).toEqual(["Asansör", "Otopark", "asansör"]);
    expect(r.criteria.uses_loan).toBe(true);
    // facade değeri yok -> zorunlu olamaz; bogus yok sayılır; budget otomatik eklenir.
    expect(r.criteria.required).toEqual(["budget", "rooms", "heating"]);
  });

  it("hataları Türkçe döner", () => {
    expect(parseDemandValues({ transaction_type: "" })).toEqual({ ok: false, error: "İşlem türü zorunlu." });
    expect(parseDemandValues({ transaction_type: "Satılık", budget_min: "9", budget_max: "5" })).toMatchObject({ ok: false });
    expect(parseDemandValues({ transaction_type: "Satılık", min_sqm: "50", max_sqm: "20" })).toMatchObject({ ok: false });
    expect(parseDemandValues({ transaction_type: "Satılık", floor_min: "9", floor_max: "2" })).toMatchObject({ ok: false });
    expect(parseDemandValues({ transaction_type: "Satılık", extra_locations: "{bozuk" })).toMatchObject({ ok: false });
  });

  it("ek bölgeleri sınırlar ve boş satırı eler", () => {
    const ok = parseDemandValues({
      transaction_type: "Satılık",
      extra_locations: JSON.stringify([
        { province_id: "aaaaaaaa-1", district_id: null, neighborhood_id: null },
        { province_id: null, district_id: null, neighborhood_id: null },
      ]),
    });
    expect(ok.ok && ok.criteria.extra_locations).toHaveLength(1);
    const many = parseDemandValues({
      transaction_type: "Satılık",
      extra_locations: JSON.stringify(Array.from({ length: 5 }, () => ({ province_id: "aaaaaaaa-1" }))),
    });
    expect(many.ok).toBe(false);
  });

  it("boş talep: criteria boş sayılır", () => {
    const r = parseDemandValues({ transaction_type: "Kiralık" });
    expect(r.ok && isEmptyCriteria(r.criteria)).toBe(true);
  });
});

describe("parseDemandCriteria", () => {
  it("eski ({}) ve geçersiz jsonb güvenle boş kriter olur", () => {
    expect(isEmptyCriteria(parseDemandCriteria({}))).toBe(true);
    expect(isEmptyCriteria(parseDemandCriteria(null))).toBe(true);
    expect(isEmptyCriteria(parseDemandCriteria([1, 2]))).toBe(true);
    expect(isEmptyCriteria(parseDemandCriteria({ required: ["uydurma"] }))).toBe(true);
  });
});

describe("form yardımcıları", () => {
  it("FormData'dan yalnız bilinen alanlar; müşterinin kendi il/ilçesi talep bölgesine karışmaz", () => {
    const fd = new FormData();
    fd.set("transaction_type", "Satılık");
    fd.set("demand_province_id", "p1");
    fd.set("province_id", "musteri-ili");
    fd.set("district_id", "musteri-ilcesi");
    fd.set("evil", "x");
    expect(demandValuesFromFormData(fd)).toEqual({ transaction_type: "Satılık", demand_province_id: "p1" });
  });

  it("hasDemandContent: yalnız varsayılan seçimler içerik sayılmaz", () => {
    expect(hasDemandContent({ transaction_type: "Satılık", property_type: "Daire", urgency: "normal" })).toBe(false);
    expect(hasDemandContent({ budget_max: "5000000" })).toBe(true);
    expect(hasDemandContent({ extra_locations: JSON.stringify([{ province_id: "aaaaaaaa-1" }]) })).toBe(true);
    expect(hasDemandContent({ extra_locations: "[]" })).toBe(false);
  });

  it("mülk sahibi / satıcı talep açmaz", () => {
    expect(isOwnerSideCustomerType("Mülk sahibi")).toBe(true);
    expect(isOwnerSideCustomerType("Satıcı")).toBe(true);
    expect(isOwnerSideCustomerType("Alıcı")).toBe(false);
    expect(isOwnerSideCustomerType("Kiracı")).toBe(false);
  });

  it("önizleme parametresi gidiş-dönüş, bilinmeyen anahtar atılır", () => {
    const enc = encodeDemandPreviewParam({ transaction_type: "Satılık", rooms: "2+1", evil: "x" });
    expect(decodeDemandPreviewParam(enc)).toEqual({ transaction_type: "Satılık", rooms: "2+1" });
    expect(decodeDemandPreviewParam("{bozuk")).toBeNull();
    expect(decodeDemandPreviewParam("[1]")).toBeNull();
  });

  it("alan adları tek ve benzersiz", () => {
    expect(new Set(DEMAND_FIELD_NAMES).size).toBe(DEMAND_FIELD_NAMES.length);
    expect(Object.values(DEMAND_FIELD_GROUPS).flat().length).toBe(DEMAND_FIELD_NAMES.length);
  });
});
