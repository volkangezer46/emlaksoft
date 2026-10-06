import { describe, expect, it } from "vitest";
import {
  buildRentalContractBody,
  fillRentalTokens,
  increaseClauseText,
  parseFixedPct,
  parseIncreaseBasis,
  rentalContractTitle,
  type RentalContractData,
} from "./build";

const data: RentalContractData = {
  landlordName: "Mehmet Kaya",
  tenantName: "Ayşe Yılmaz",
  propertyTitle: "3+1 Bahçe Katı Daire",
  propertyAddress: "Çankaya / Birlik Mah.",
  monthlyRent: 25000,
  deposit: 50000,
  dueDay: 5,
  startDate: "2026-11-01",
  endDate: "2027-10-31",
  officeName: "Vadi Emlak",
  increaseBasis: "tufe",
  fixedPct: null,
};

describe("buildRentalContractBody", () => {
  it("kira kaydı bilgilerini gövdeye işler", () => {
    const b = buildRentalContractBody(data);
    expect(b).toContain("Ayşe Yılmaz");
    expect(b).toContain("Mehmet Kaya");
    expect(b).toMatch(/25\.000/);
    expect(b).toContain("01.11.2026");
    expect(b).toContain("31.10.2027");
    expect(b).toContain("her ayın 5. gününe kadar");
    expect(b).toMatch(/Türk Borçlar Kanunu m\.344/);
  });
  it("bilinmeyen alanlar boşluk bırakır ve taslak notu taşır", () => {
    const b = buildRentalContractBody({ ...data, landlordName: null, deposit: null, endDate: null });
    expect(b).toContain("Kiraya Veren: ___");
    expect(b).toContain("belirsiz süreli");
    expect(b).toContain("Depozito: ___");
    expect(b).toMatch(/hukuki danışmanlık değildir/);
    expect(b).not.toMatch(/hukuken geçerli/i);
  });
});

describe("artış maddesi", () => {
  it("üç tür ve TÜFE sınırı", () => {
    expect(increaseClauseText("tufe", null)).toMatch(/on iki aylık TÜFE/);
    expect(increaseClauseText("sabit", 20)).toContain("%20");
    expect(increaseClauseText("sabit", 20)).toMatch(/aşamaz/);
    expect(increaseClauseText("sabit", null)).toContain("___");
    expect(increaseClauseText("yok", null)).toMatch(/sabittir/);
  });
  it("doğrulama", () => {
    expect(parseIncreaseBasis("tufe")).toBe("tufe");
    expect(parseIncreaseBasis("x")).toBeNull();
    expect(parseFixedPct("")).toEqual({ ok: true, value: null });
    expect(parseFixedPct("25,5")).toEqual({ ok: true, value: 25.5 });
    expect(parseFixedPct("101").ok).toBe(false);
    expect(parseFixedPct("abc").ok).toBe(false);
  });
});

describe("fillRentalTokens", () => {
  it("ofis şablonundaki alanları doldurur, bilinmeyeni korur", () => {
    const out = fillRentalTokens("Kiracı {kiraci}, bedel {kira_bedeli}, vade {vade_gunu}. {notum}", data);
    expect(out).toContain("Ayşe Yılmaz");
    expect(out).toMatch(/25\.000/);
    expect(out).toContain("vade 5");
    expect(out).toContain("{notum}");
  });
});

describe("rentalContractTitle", () => {
  it("birleşik başlık", () => {
    expect(rentalContractTitle(data)).toBe("Kira Sözleşmesi — 3+1 Bahçe Katı Daire — Ayşe Yılmaz");
    expect(rentalContractTitle({ propertyTitle: null, tenantName: null })).toBe("Kira Sözleşmesi");
  });
});
