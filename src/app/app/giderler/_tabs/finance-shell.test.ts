import { describe, expect, it } from "vitest";
import { FINANCE_TAB_META, FINANCE_VISIBLE_TABS, financeHref, resolveFinanceTab } from "./finance-shell";

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
});
