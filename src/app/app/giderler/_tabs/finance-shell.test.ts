import { describe, expect, it } from "vitest";
import { agingBucketKeyOf } from "@/lib/finance/party/aging";
import { parseLedgerFilters } from "../hareketler/ledger-filters";
import { FINANCE_TAB_META, FINANCE_VISIBLE_TABS, financeHref, overviewLinks, resolveFinanceTab } from "./finance-shell";

/** Adresi sekme + parametrelere ayırır (sayfanın `resolveFinanceTab` ile yaptığı gibi). */
function target(href: string) {
  const url = new URL(href, "https://x.test");
  const raw = Object.fromEntries(url.searchParams.entries());
  return { path: url.pathname, ...resolveFinanceTab(raw) };
}

describe("Muhasebe sekme çözümü (FN2)", () => {
  it("takma adlar: ozet → genel; faturalar → belgeler + tur=fatura; bilinmeyen → genel", () => {
    expect(resolveFinanceTab({ sekme: "ozet" }).tab).toBe("genel");
    expect(resolveFinanceTab({ sekme: "faturalar" })).toMatchObject({ tab: "belgeler", params: { tur: "fatura" } });
    expect(resolveFinanceTab({ sekme: "yok-boyle" }).tab).toBe("genel");
    expect(resolveFinanceTab({}).tab).toBe("genel");
    expect(resolveFinanceTab({ sekme: "cari" }).tab).toBe("cari");
  });

  it("eski derin bağlantılar: ?portfoy= / ?from= → Hareketler, ?portal= → Bütçe (filtreler korunur)", () => {
    expect(resolveFinanceTab({ portfoy: "x" })).toMatchObject({ tab: "hareketler", params: { portfoy: "x" } });
    expect(resolveFinanceTab({ from: "2026-10-01", to: "2026-10-31" })).toMatchObject({ tab: "hareketler", params: { from: "2026-10-01" } });
    expect(resolveFinanceTab({ portal: "sahibinden" }).tab).toBe("butce");
  });

  it("şerit: 10 sekme, 5 görünür + Diğer; ilk sekme parametresiz adres", () => {
    expect(FINANCE_TAB_META).toHaveLength(10);
    expect(FINANCE_VISIBLE_TABS).toBe(5);
    expect(FINANCE_TAB_META.slice(0, 5).map((t) => t.id)).toEqual(["genel", "hareketler", "kasa-banka", "cari", "belgeler"]);
    expect(financeHref("genel")).toBe("/app/giderler");
    expect(financeHref("cari", { yon: "alacak", bos: null })).toBe("/app/giderler?sekme=cari&yon=alacak");
  });

  it("Genel bakış hedefleri yalnız hedef sekmenin okuduğu parametreleri kullanır (sıfır çıkmaz metrik)", () => {
    const l = overviewLinks();
    // Cari (FN4): açık kalemler görünümü + yön (alacak|borc) + vade kovası (agingBucketKeyOf ya da "gecikmis").
    for (const [href, yon] of [
      [l.receivable, "alacak"],
      [l.payable, "borc"],
    ] as const) {
      const t = target(href);
      expect(t.path).toBe("/app/giderler");
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
    expect(Object.keys(review.params).filter((k) => k !== "sekme")).toEqual([]);
  });
});
