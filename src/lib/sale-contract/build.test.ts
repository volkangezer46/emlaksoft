import { describe, expect, it } from "vitest";
import { buildDealContractBody, dealContractTitle, fillDealTokens, parseDealContractKind, type DealContractData } from "./build";

const base: DealContractData = {
  dealType: "sale",
  buyerName: "Ayşe Demir",
  sellerName: "Mehmet Kaya",
  propertyTitle: "3+1 Daire",
  propertyCode: "P-101",
  propertyAddress: "Moda Cad. No:5 Kadıköy",
  price: 5_000_000,
  depositAmount: 250_000,
  paymentMethodLabel: "Konut kredisi",
  deedDate: "2026-11-20",
  officeName: "Örnek Emlak",
  validUntil: "2026-10-30",
  creditContingency: true,
};

describe("deal contract builder", () => {
  it("kapora taslağı anlaşma/teklif verisiyle dolar; kredi şartı maddesi eklenir", () => {
    const body = buildDealContractBody("kapora", base);
    expect(body).toContain("Alıcı: Ayşe Demir");
    expect(body).toContain("Satıcı: Mehmet Kaya");
    expect(body).toMatch(/Satış Bedeli: ₺5\.000\.000/);
    expect(body).toMatch(/Kapora: +₺250\.000/);
    expect(body).toContain("20.11.2026");
    expect(body).toContain("MADDE 4 — Kredi Şartı");
    expect(body).toContain("MADDE 5 — Aracı");
  });

  it("bilinmeyen alan boş çizgi kalır; kiralıkta kiracı/kiraya veren dili", () => {
    const body = buildDealContractBody("kapora", { ...base, dealType: "rent", sellerName: null, depositAmount: null, creditContingency: false });
    expect(body).toContain("Kiraya Veren: ___");
    expect(body).toContain("Kiracı Adayı: Ayşe Demir");
    expect(body).not.toContain("Kredi Şartı");
    expect(body).toMatch(/Kapora: +___/);
  });

  it("aracılık taslağı ve başlık", () => {
    expect(buildDealContractBody("aracilik", base)).toContain("ALIM-SATIM ARACILIK SÖZLEŞMESİ");
    expect(dealContractTitle("kapora", base)).toBe("Kapora Sözleşmesi — Ayşe Demir");
    expect(dealContractTitle("aracilik", { ...base, buyerName: null })).toBe("Aracılık Sözleşmesi");
    expect(parseDealContractKind("aracilik")).toBe("aracilik");
    expect(parseDealContractKind("x")).toBe("kapora");
  });

  it("ofis şablonu alanları dolar, bilinmeyen alan korunur", () => {
    expect(fillDealTokens("{alici} / {satici} / {kapora_tutari} / {bilinmeyen}", base)).toBe("Ayşe Demir / Mehmet Kaya / ₺250.000 / {bilinmeyen}");
  });
});
