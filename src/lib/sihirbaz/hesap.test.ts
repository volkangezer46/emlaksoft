import { describe, expect, it } from "vitest";
import {
  decodeSplits,
  defaultSplits,
  encodeSplits,
  moveInTotals,
  oneYearTermEnd,
  parseMoney,
  parsePercent,
  rentTermLines,
  salePreview,
  splitRowsError,
} from "./hesap";

describe("oran ve tutar ayrıştırma", () => {
  it("yüzde", () => {
    expect(parsePercent("2,5")).toBe(2.5);
    expect(parsePercent("%3")).toBe(3);
    expect(parsePercent("2.5")).toBe(2.5);
    expect(parsePercent("100")).toBe(100);
    expect(parsePercent("0")).toBeNull();
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("2,555")).toBeNull();
    expect(parsePercent("")).toBeNull();
  });
  it("para", () => {
    expect(parseMoney("4.500.000")).toBe(4_500_000);
    expect(parseMoney("1.250,50")).toBe(1250.5);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("0")).toBeNull();
  });
});

describe("satış komisyonu ve paylaşım önizlemesi", () => {
  it("komisyon = fiyat × oran; pay = KDV hariç komisyon × pay oranı (sunucuyla aynı)", () => {
    const p = salePreview(5_000_000, 2, defaultSplits(60));
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.net).toBe(100_000);
    expect(p.vat).toBe(20_000);
    expect(p.gross).toBe(120_000);
    expect(p.rows).toEqual([
      { label: "Danışman", rate: 60, amount: 60_000 },
      { label: "Ofis", rate: 40, amount: 40_000 },
    ]);
    expect(p.totalRate).toBe(100);
    expect(p.remainderRate).toBe(0);
  });

  it("paylaştırılmayan oran ofiste kalan olarak görünür; tutar/oran yoksa hesap yok", () => {
    const p = salePreview(1_000_000, 3, [{ label: "Danışman", rate: "50" }, { label: "Referans", rate: "10" }]);
    expect(p?.remainderRate).toBe(40);
    expect(p?.remainderAmount).toBe(12_000);
    expect(salePreview(null, 3, [])).toBeNull();
    expect(salePreview(1_000_000, null, [])).toBeNull();
  });

  it("kuruş yuvarlama: %33,33 / %66,67", () => {
    const p = salePreview(1_234_567, 2.5, [{ label: "Danışman", rate: "33,33" }, { label: "Ofis", rate: "66,67" }]);
    expect(p?.net).toBe(30_864.18);
    expect(p?.rows.map((r) => r.amount)).toEqual([10_287.03, 20_577.15]);
  });

  it("paylaşım kuralı: en az bir satır, toplam ≤ %100", () => {
    expect(splitRowsError([{ label: "", rate: "" }])).toMatch(/En az bir/);
    expect(splitRowsError([{ label: "A", rate: "60" }, { label: "B", rate: "50" }])).toMatch(/aşamaz/);
    expect(splitRowsError(defaultSplits(50))).toBeNull();
  });

  it("paylar tek metin alanında gidip gelir", () => {
    const rows = [{ label: "Danışman", rate: "55" }, { label: "Ofis: merkez", rate: "45" }];
    expect(decodeSplits(encodeSplits(rows))).toEqual([{ label: "Danışman", rate: "55" }, { label: "Ofis  merkez", rate: "45" }]);
    expect(decodeSplits("")).toEqual([]);
  });

  it("varsayılan paylaşım ofis tanımından, geçersizse 50/50", () => {
    expect(defaultSplits(70)).toEqual([{ label: "Danışman", rate: "70" }, { label: "Ofis", rate: "30" }]);
    expect(defaultSplits(null)).toEqual([{ label: "Danışman", rate: "50" }, { label: "Ofis", rate: "50" }]);
  });
});

describe("kira taşınma maliyeti", () => {
  it("ilk kira + depozito + aidat + kiracının ödediği hizmet bedeli (KDV dahil)", () => {
    const t = moveInTotals({ rent: 25_000, deposit: 50_000, dues: 1_500, commissionRate: 100, tenantPaysCommission: true });
    expect(t).toEqual({
      firstRent: 25_000,
      deposit: 50_000,
      dues: 1_500,
      commissionNet: 25_000,
      commissionVat: 5_000,
      commissionPaidByTenant: 30_000,
      total: 106_500,
      annualRent: 300_000,
    });
  });
  it("hizmet bedelini malik öderse toplamda yok; oran yoksa hizmet bedeli 0; kira yoksa null", () => {
    expect(moveInTotals({ rent: 20_000, deposit: null, dues: null, commissionRate: 100, tenantPaysCommission: false })?.total).toBe(20_000);
    expect(moveInTotals({ rent: 20_000, deposit: 40_000, dues: null, commissionRate: null, tenantPaysCommission: true })?.commissionPaidByTenant).toBe(0);
    expect(moveInTotals({ rent: null, deposit: 1, dues: 1, commissionRate: 1, tenantPaysCommission: true })).toBeNull();
  });
  it("kira koşulu satırları", () => {
    const fmt = (n: number) => `${n} ₺`;
    expect(rentTermLines({ rule: "tufe", fixedRate: "", dues: 1500, formatMoney: fmt })).toEqual([
      "Artış kuralı: her kira yılında TÜFE 12 aylık ortalaması (konutta TBK 344 tavanı).",
      "Aidat: 1500 ₺ / ay, kiracı öder.",
    ]);
    expect(rentTermLines({ rule: "sabit", fixedRate: "25", dues: null, formatMoney: fmt })).toEqual(["Artış kuralı: her kira yılında %25 (konutta TÜFE tavanını aşamaz)."]);
    expect(rentTermLines({ rule: "yok", fixedRate: "", dues: 0, formatMoney: fmt })).toEqual([]);
  });
  it("bir yıllık süre önerisi (artık yıl dahil)", () => {
    expect(oneYearTermEnd("2026-11-01")).toBe("2027-10-31");
    expect(oneYearTermEnd("2027-03-01")).toBe("2028-02-29");
    expect(oneYearTermEnd("bozuk")).toBe("");
  });
});
