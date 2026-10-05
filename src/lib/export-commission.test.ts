import { describe, expect, it } from "vitest";
import { commissionShares, mapCommission } from "./export-entities";

describe("mapCommission (komisyon CSV)", () => {
  const row = {
    gross_amount: 120000,
    vat_amount: 20000,
    status: "paid",
    created_at: "2026-10-01T10:00:00Z",
    splits: [
      { label: "Danışman", rate: 50, amount: 50000 },
      { label: "Ofis", rate: 50, amount: 50000 },
    ],
    deal: { assigned_to: "u1", property: { property_code: "PRT-1", title: "Kadıköy 3+1" } },
  };

  it("Türkçe başlıklar ve yeni sütunlar", () => {
    const out = mapCommission(row, new Map([["u1", "Ayşe Yılmaz"]]));
    expect(Object.keys(out)).toEqual([
      "Portföy Kodu",
      "Portföy Başlığı",
      "Danışman",
      "Brüt Tutar",
      "KDV",
      "Danışman Payı",
      "Ofis Payı",
      "Ödeme Durumu",
      "Kayıt Tarihi",
    ]);
    expect(out).toMatchObject({
      "Portföy Kodu": "PRT-1",
      "Portföy Başlığı": "Kadıköy 3+1",
      Danışman: "Ayşe Yılmaz",
      "Danışman Payı": 50000,
      "Ofis Payı": 50000,
      "Ödeme Durumu": "Tahsil edildi",
    });
  });
  it("tahsilat tarihi / vade / fatura no sütunu YOK (veri modelinde alan yok)", () => {
    const keys = Object.keys(mapCommission(row)).join("|");
    expect(keys).not.toMatch(/Tahsilat Tarihi|Vade|Fatura/);
  });
  it("gömülü ilişki dizi gelirse ve ad/pay yoksa boş kalır", () => {
    const out = mapCommission({ gross_amount: 1, vat_amount: 0, status: "x", created_at: "t", splits: [], deal: [{ assigned_to: null }] });
    expect(out["Portföy Kodu"]).toBe("");
    expect(out["Danışman"]).toBe("");
    expect(out["Danışman Payı"]).toBe("");
    expect(out["Ödeme Durumu"]).toBe("x");
  });
});

describe("commissionShares", () => {
  it("Ofis etiketi ofis payı, diğerleri danışman payı", () => {
    expect(commissionShares([{ label: "Ofis", amount: 10.5 }, { label: "Ali", amount: 4 }, { label: "Veli", amount: 1 }])).toEqual({ advisor: 5, office: 10.5 });
    expect(commissionShares(null)).toEqual({ advisor: null, office: null });
  });
});
