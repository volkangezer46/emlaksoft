import { describe, expect, it } from "vitest";
import { compactTry, countByType, featureSummary, priceHealthPill, propertyStatusTone } from "./property-list-logic";

describe("propertyStatusTone", () => {
  it("yayında → success, rezerve → warning, satıldı/kiralandı → info, vazgeçildi → danger", () => {
    expect(propertyStatusTone("live")).toBe("success");
    expect(propertyStatusTone("Yayında")).toBe("success");
    expect(propertyStatusTone("reserved")).toBe("warning");
    expect(propertyStatusTone("sold")).toBe("info");
    expect(propertyStatusTone("rented")).toBe("info");
    expect(propertyStatusTone("withdrawn")).toBe("danger");
  });
  it("taslak/pasif/arşiv/bilinmeyen nötr", () => {
    for (const s of ["draft", "passive", "archived", "xyz", null, undefined]) expect(propertyStatusTone(s)).toBe("neutral");
  });
});

describe("priceHealthPill", () => {
  it("Türkçe ve İngilizce değerleri eşler, bilinmeyende null döner", () => {
    expect(priceHealthPill("green")).toEqual({ tone: "success", label: "Uygun" });
    expect(priceHealthPill("Sarı")).toEqual({ tone: "warning", label: "İzlenmeli" });
    expect(priceHealthPill("red")).toEqual({ tone: "danger", label: "Riskli" });
    expect(priceHealthPill("pending")).toBeNull();
    expect(priceHealthPill(null)).toBeNull();
  });
});

describe("featureSummary", () => {
  it("yalnız dolu alanları birleştirir", () => {
    expect(featureSummary({ sqm: 140, rooms: "3+1", floor: 4 })).toBe("140 m² · 3+1 · 4. kat");
    expect(featureSummary({ rooms: "2+1" })).toBe("2+1");
    expect(featureSummary({ sqm: 0, rooms: " " })).toBeNull();
    expect(featureSummary(null)).toBeNull();
  });
});

describe("compactTry", () => {
  it("kısaltma yok: her tutar tam TL", () => {
    expect(compactTry(93_549_500)).toBe("₺93.549.500");
    expect(compactTry(1_250_000_000)).toBe("₺1.250.000.000");
    expect(compactTry(450_000)).toBe("₺450.000");
    expect(compactTry(0)).toBe("₺0");
  });
});

describe("countByType", () => {
  it("boş tipleri atar, adetleri toplar", () => {
    expect(countByType([{ property_type: "Daire" }, { property_type: "Daire" }, { property_type: "Arsa" }, { property_type: null }])).toEqual({
      Daire: 2,
      Arsa: 1,
    });
  });
});
