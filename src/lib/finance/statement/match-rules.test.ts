import { describe, expect, it } from "vitest";
import { buildDecision, ruleMatchesLine, ruleTextFromDescription, suggestAll, suggestFromRules, type FinanceRuleLike } from "./match";

const rule = (p: Partial<FinanceRuleLike>): FinanceRuleLike => ({
  id: "r1", direction: "out", matchText: null, ibanLast4: null, amountMin: null, amountMax: null, category: "portal", partyId: null, mode: "suggest", ...p,
});

describe("ofis kuralları (kural olarak kaydet)", () => {
  it("açıklamadan kural metni: rakam, kısa ve banka gürültüsü sözcükleri atılır", () => {
    expect(ruleTextFromDescription("EFT ÖDEME 123456 SAHİBİNDEN.COM İLAN PAKETİ Ref:99")).toBe("sahibinden com ilan");
    expect(ruleTextFromDescription("HAVALE 12 34")).toBe("");
  });

  it("kayıtlı kural sonraki benzer satırda öneri çıkarır; yön, tutar aralığı ve IBAN uyulur", () => {
    const r = rule({ matchText: ruleTextFromDescription("EFT SAHİBİNDEN.COM İLAN PAKETİ"), amountMax: 10_000 });
    expect(ruleMatchesLine(r, { dir: "out", amount: 4500, description: "Fast ödeme sahibinden com ilan bedeli Kasım" })).toBe(true);
    expect(ruleMatchesLine(r, { dir: "in", amount: 4500, description: "sahibinden com ilan" })).toBe(false);
    expect(ruleMatchesLine(r, { dir: "out", amount: 20_000, description: "sahibinden com ilan" })).toBe(false);
    expect(ruleMatchesLine(rule({ matchText: null }), { dir: "out", amount: 1, description: "her şey" })).toBe(false);
    expect(ruleMatchesLine(rule({ ibanLast4: "1234" }), { dir: "out", amount: 1, description: "x", ibanLast4: "1234" })).toBe(true);
  });

  it("daha özel kural önce; maaş yalnız yetkiliye; yönle uyumsuz kategori önerilmez", () => {
    const rules = [rule({ id: "genel", matchText: "sahibinden", category: "reklam" }), rule({ id: "ozel", matchText: "sahibinden com ilan", category: "portal" })];
    expect(suggestFromRules({ dir: "out", amount: 10, description: "SAHIBINDEN COM ILAN" }, rules, false)?.ruleId).toBe("ozel");
    expect(suggestFromRules({ dir: "out", amount: 10, description: "personel maaş" }, [rule({ matchText: "personel", category: "maas" })], false)).toBeNull();
    expect(suggestFromRules({ dir: "out", amount: 10, description: "x komisyon" }, [rule({ matchText: "komisyon", category: "komisyon" })], true)).toBeNull();
  });

  it("suggestAll: kural, anahtar sözcük tahmininden önce gelir; karar 'create' + kural kategorisi", () => {
    const lines = [{ id: "l1", date: "2026-10-01", dir: "out" as const, amount: 4500, description: "SAHIBINDEN COM ILAN" }];
    const s = suggestAll(lines, { entries: [], collections: [], rules: [], financeRules: [rule({ matchText: "sahibinden com", category: "reklam" })], canSalary: false });
    const got = s.get("l1");
    expect(got?.kind).toBe("rule");
    expect(buildDecision("l1", got!, { action: "create", category: "reklam" })).toEqual({ lineId: "l1", action: "create", category: "reklam", title: null });
  });
});
