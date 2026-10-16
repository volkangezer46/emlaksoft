import { describe, expect, it } from "vitest";
import { parseLedgerFilters } from "../_hareketler/ledger-filters";
import { financeSectionOf } from "@/lib/finance/routes";
import { insightLinks, monthRange } from "./insight-links";

function target(href: string) {
  const url = new URL(href, "https://x.test");
  return { path: url.pathname, hash: url.hash, tab: financeSectionOf(url.pathname), params: Object.fromEntries(url.searchParams.entries()) as Record<string, string> };
}
const ledger = (href: string) => parseLedgerFilters(target(href).params, { canSalary: true });

describe("monthRange", () => {
  it("ayın ilk ve son günü", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("Zeka kartı hedefleri Hareketler süzgecine birebir düşer (sıfır çıkmaz metrik)", () => {
  const { from, to } = monthRange("2026-09");

  it("fişsiz gider = tur=gider + belge=yok + ay aralığı", () => {
    const f = ledger(insightLinks.receiptless(from, to));
    expect(target(insightLinks.receiptless(from, to)).tab).toBe("hareketler");
    expect(f).toMatchObject({ tur: "gider", belgeYok: true, from, to });
  });

  it("KDV bilgisi yok = kdv=yok", () => {
    expect(ledger(insightLinks.noVat(from, to))).toMatchObject({ kdv: "yok", from, to });
  });

  it("kategori artışı: geçerli kategori süzülür; kategorisiz toplama anahtarı süzülmez", () => {
    expect(ledger(insightLinks.categoryExpenses("reklam", from, to))).toMatchObject({ tur: "gider", kategori: "reklam" });
    expect(ledger(insightLinks.categoryExpenses("diger_gider", from, to)).kategori).toBe("");
    expect(ledger(insightLinks.categoryExpenses("Bozuk Anahtar", from, to)).kategori).toBe("");
  });

  it("mükerrer ödeme: arama metni ve tarih aralığı", () => {
    expect(ledger(insightLinks.duplicate("Enerjisa", "2026-10-01", "2026-10-03"))).toMatchObject({ tur: "gider", q: "Enerjisa", from: "2026-10-01", to: "2026-10-03" });
  });

  it("mutabakat: tek banka → hesap + mutabik=hayir; çok banka → Kasa ve banka", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(ledger(insightLinks.unreconciled([id], from, to))).toMatchObject({ accountId: id, mutabikYok: true, from, to });
    expect(target(insightLinks.unreconciled([id, id], from, to)).tab).toBe("kasa-banka");
  });

  it("vergi yılı ve dönem kilidi", () => {
    expect(target(insightLinks.vatYear("2026"))).toMatchObject({ tab: "vergi", params: { yil: "2026" } });
    const lock = target(insightLinks.periodLock());
    expect(lock.tab).toBe("ayarlar");
    expect(lock.hash).toBe("#donem");
  });
});
