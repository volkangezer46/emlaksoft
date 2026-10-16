import { describe, expect, it } from "vitest";
import { agingBucketKeyOf } from "@/lib/finance/party/aging";
import { parseLedgerFilters } from "../_hareketler/ledger-filters";
import { FINANCE_SECTIONS, financeHref, financeSectionOf } from "@/lib/finance/routes";
import { FINANCE_SECTION_META, financeCommandTabs, financeTitle, overviewLinks } from "./finance-shell";

/** Adresi alt alan + parametrelere ayırır (sayfa yolu = alt alan; süzgeçler sorguda). */
function target(href: string) {
  const url = new URL(href, "https://x.test");
  return { path: url.pathname, tab: financeSectionOf(url.pathname), params: Object.fromEntries(url.searchParams.entries()) as Record<string, string> };
}

describe("Finans alt alanları (WP6)", () => {
  it("alt alan meta: menü sırası, yol üretimi; kayıt sayfası şeritte değil", () => {
    expect(FINANCE_SECTION_META.map((t) => t.id)).toEqual(FINANCE_SECTIONS.filter((s) => s !== "kayit"));
    expect(FINANCE_SECTION_META.slice(0, 5).map((t) => t.id)).toEqual(["genel", "hareketler", "kasa-banka", "cari", "komisyon"]);
    expect(financeHref("genel")).toBe("/app/finans");
    expect(financeHref("cari", { yon: "alacak", bos: null })).toBe("/app/finans/cari?yon=alacak");
    expect(financeTitle("genel")).toBe("Finans");
    expect(financeTitle("tekrarlayan")).toBe("Tekrarlayanlar · Finans");
  });

  it("komut çubuğu yalnız izinli modülün alanlarını listeler", () => {
    const onlyCommissions = financeCommandTabs({ expenses: false, commissions: true }).map((t) => t.id);
    expect(onlyCommissions).toEqual(["komisyon", "hakedis"]);
    expect(financeCommandTabs().every((t) => t.href.startsWith("/app/finans"))).toBe(true);
  });

  it("Genel bakış hedefleri yalnız hedef sekmenin okuduğu parametreleri kullanır (sıfır çıkmaz metrik)", () => {
    const l = overviewLinks();
    // Cari (FN4): açık kalemler görünümü + yön (alacak|borc) + vade kovası (agingBucketKeyOf ya da "gecikmis").
    for (const [href, yon] of [
      [l.receivable, "alacak"],
      [l.payable, "borc"],
    ] as const) {
      const t = target(href);
      expect(t.path).toBe("/app/finans/cari");
      expect(t.tab).toBe("cari");
      expect(t.params).toMatchObject({ gorunum: "acik", yon });
    }
    for (const href of [l.overdue, l.forecastDay, l.openItems]) {
      const t = target(href);
      expect(t.tab).toBe("cari");
      expect(t.params.gorunum).toBe("acik");
      const kova = t.params.kova;
      if (kova) expect(kova === "gecikmis" || agingBucketKeyOf(kova) !== null).toBe(true);
      expect(t.params).not.toHaveProperty("vade");
    }
    expect(target(l.overdue).params.kova).toBe("gecikmis");
    // Hareketler (FN3): eski giderler süzgeci gerçekten süzer.
    const legacy = target(l.legacy);
    expect(legacy.tab).toBe("hareketler");
    expect(parseLedgerFilters(legacy.params, { canSalary: false }).kaynak).toBe("eski");
    // Kasa ve banka (FN3): kuyruk sekmenin kendisinde; desteklenmeyen parametre yok.
    const review = target(l.review);
    expect(review.tab).toBe("kasa-banka");
    expect(Object.keys(review.params)).toEqual([]);
  });
});
