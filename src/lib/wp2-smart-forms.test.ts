import { describe, expect, it } from "vitest";
import { autoSelectPropertyId, rankPropertySuggestions, type PropertySuggestionInput } from "./property-suggestions";
import { canAssignCustomerToOthers, normalizeCustomerSource, resolveCustomerAssignee, suggestLeastLoadedAssignee } from "./customer-assignee";
import { mergeEffectivePermissions } from "./permissions-merge";
import { entryPageMode } from "./finance/entry-workspace";
import { isOwnReceiptPath, validateReceiptFile, expenseClaimOutcomeMessage, EXPENSE_CLAIM_HREF, expenseClaimPath } from "./finance/expense-claim";

/** WP2 akıllı formlar: önerilen portföy sıralaması, danışman ataması, kaynak, masraf bildir kuralları. */

const deal = (over: Partial<PropertySuggestionInput["deals"][number]> = {}) => ({
  dealId: "d1", propertyId: "pA", label: "Kadıköy 3+1", stage: "negotiation", stageLabel: "Müzakere", value: 12_000_000, updatedAt: "2026-10-10", ...over,
});

describe("önerilen portföyler", () => {
  it("5c373c42 senaryosu: Müzakere anlaşması + aynı portföye teklif + eşleşmeler → anlaşma portföyü ilk ve otomatik seçili", () => {
    const input: PropertySuggestionInput = {
      deals: [deal()],
      offers: [{ propertyId: "pA", label: "Kadıköy 3+1", status: "submitted", amount: 11_500_000, createdAt: "2026-10-11" }],
      matches: [{ propertyId: "pA", label: "Kadıköy 3+1", score: 95 }, { propertyId: "pB", label: "Moda 2+1", score: 80 }],
    };
    const list = rankPropertySuggestions(input);
    expect(list.map((s) => s.propertyId)).toEqual(["pA", "pB"]);
    expect(list[0]).toMatchObject({ source: "deal", reason: "Açık anlaşma · Müzakere · ₺12.000.000" });
    expect(list[1]).toMatchObject({ source: "match", reason: "Talebe uygun · 80 puan" });
    expect(autoSelectPropertyId(input)).toBe("pA");
  });

  it("sıra: müzakere > nitelikli > yeni; teklifte karşı teklif > gönderildi; eşleşmeden en çok 5", () => {
    const input: PropertySuggestionInput = {
      deals: [deal({ dealId: "d2", propertyId: "pN", stage: "new", stageLabel: "Yeni" }), deal({ dealId: "d3", propertyId: "pQ", stage: "qualified", stageLabel: "Nitelikli" }), deal()],
      offers: [{ propertyId: "pS", label: "S", status: "submitted", amount: null, createdAt: "2026-10-12" }, { propertyId: "pC", label: "C", status: "countered", amount: 5, createdAt: "2026-10-01" }, { propertyId: "pX", label: "X", status: "rejected", amount: 1, createdAt: "2026-10-13" }],
      matches: Array.from({ length: 8 }, (_, i) => ({ propertyId: `m${i}`, label: `M${i}`, score: 50 + i })),
    };
    const ids = rankPropertySuggestions(input).map((s) => s.propertyId);
    expect(ids.slice(0, 5)).toEqual(["pA", "pQ", "pN", "pC", "pS"]);
    expect(ids).not.toContain("pX");
    expect(ids.slice(5)).toEqual(["m7", "m6", "m5", "m4", "m3"]);
    expect(autoSelectPropertyId(input)).toBeNull(); // birden çok aday: otomatik seçim yok
  });

  it("?deal= verilen anlaşma en üstte ve seçili; yalnız eşleşme varsa otomatik seçim yok", () => {
    const input: PropertySuggestionInput = { deals: [deal(), deal({ dealId: "d9", propertyId: "pZ", stage: "new", stageLabel: "Yeni" })], offers: [], matches: [], preferDealId: "d9" };
    expect(rankPropertySuggestions(input)[0]!.propertyId).toBe("pZ");
    expect(autoSelectPropertyId(input)).toBe("pZ");
    expect(autoSelectPropertyId({ deals: [], offers: [], matches: [{ propertyId: "m", label: "m", score: 99 }] })).toBeNull();
  });
});

describe("yeni müşteride danışman ataması", () => {
  const eff = (r: string) => mergeEffectivePermissions(r, [], []);
  it("başkasına atama: owner/gm/şube müdürü (customers:edit + ofis geneli) evet; takım lideri/danışman/çağrı merkezi hayır", () => {
    for (const r of ["owner", "gm", "branch_manager"]) expect(canAssignCustomerToOthers(r, eff(r)), r).toBe(true);
    for (const r of ["team_lead", "advisor", "call_center", "readonly"]) expect(canAssignCustomerToOthers(r, eff(r)), r).toBe(false);
    const noEdit = mergeEffectivePermissions("branch_manager", [{ module: "customers", action: "edit", allowed: false }], []);
    expect(canAssignCustomerToOthers("branch_manager", noEdit)).toBe(false);
  });

  it("karar: boş/kendisi → kendisi; yetkisiz → ret; pasif/satış dışı → ret; geçerli → hedef", () => {
    expect(resolveCustomerAssignee({ requested: "", userId: "u", canAssignOthers: false })).toEqual({ ok: true, assignedTo: "u" });
    expect(resolveCustomerAssignee({ requested: "u", userId: "u", canAssignOthers: false })).toEqual({ ok: true, assignedTo: "u" });
    expect(resolveCustomerAssignee({ requested: "x", userId: "u", canAssignOthers: false }).ok).toBe(false);
    expect(resolveCustomerAssignee({ requested: "x", userId: "u", canAssignOthers: true, target: null }).ok).toBe(false);
    expect(resolveCustomerAssignee({ requested: "x", userId: "u", canAssignOthers: true, target: { id: "x", role: "advisor", is_active: false } }).ok).toBe(false);
    expect(resolveCustomerAssignee({ requested: "x", userId: "u", canAssignOthers: true, target: { id: "x", role: "readonly", is_active: true } }).ok).toBe(false);
    expect(resolveCustomerAssignee({ requested: "x", userId: "u", canAssignOthers: true, target: { id: "x", role: "advisor", is_active: true } })).toEqual({ ok: true, assignedTo: "x" });
  });

  it("öneri: danışman/takım lideri öncelikli, en az müşterili; eşitlikte ada göre", () => {
    const members = [
      { id: "o", name: "Sahip", role: "owner" },
      { id: "a", name: "Ayşe", role: "advisor" },
      { id: "b", name: "Burak", role: "advisor" },
      { id: "c", name: "Can", role: "accounting" },
    ];
    expect(suggestLeastLoadedAssignee(members, ["a", "a", "b", "o"])).toEqual({ id: "b", name: "Burak", openCustomers: 1 });
    expect(suggestLeastLoadedAssignee(members, [])!.id).toBe("a");
    expect(suggestLeastLoadedAssignee([{ id: "o", name: "Sahip", role: "owner" }], [])!.id).toBe("o");
    expect(suggestLeastLoadedAssignee([{ id: "c", name: "Can", role: "accounting" }], [])).toBeNull();
  });

  it("kaynak: tanım anahtarı biçimi, aksi null", () => {
    expect(normalizeCustomerSource("portal_sahibinden")).toBe("portal_sahibinden");
    expect(normalizeCustomerSource(" telefon ")).toBe("telefon");
    expect(normalizeCustomerSource("<script>")).toBeNull();
    expect(normalizeCustomerSource("")).toBeNull();
  });
});

describe("Masraf bildir", () => {
  it("kayıt sayfası kipi: ofis defteri yetkisi yoksa teklif, salt okunurda ret", () => {
    expect(entryPageMode({ personal: true, canCreateOffice: false, role: "advisor" })).toBe("personal");
    expect(entryPageMode({ personal: false, canCreateOffice: true, role: "accounting" })).toBe("office");
    expect(entryPageMode({ personal: false, canCreateOffice: false, role: "advisor" })).toBe("claim");
    expect(entryPageMode({ personal: false, canCreateOffice: false, role: "readonly" })).toBe("denied");
  });

  it("fiş dosyası ve yolu", () => {
    expect(validateReceiptFile({ size: 1000, type: "image/jpeg" })).toEqual({ ok: true, ext: "jpg", mime: "image/jpeg" });
    expect(validateReceiptFile({ size: 6 * 1024 * 1024, type: "image/png" }).ok).toBe(false);
    expect(validateReceiptFile({ size: 10, type: "text/html" }).ok).toBe(false);
    const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const U = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const F = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(isOwnReceiptPath(`${T}/${U}/${F}.jpg`, T, U)).toBe(true);
    expect(isOwnReceiptPath(`${T}/${F}/${F}.jpg`, T, U)).toBe(false);
    expect(isOwnReceiptPath(`${T}/${U}/../x.jpg`, T, U)).toBe(false);
    expect(EXPENSE_CLAIM_HREF).toBe("/app/finans/kayit/masraf");
    expect(expenseClaimPath(F)).toBe(`/app/finans/kayit/masraf/${F}`);
    expect(expenseClaimOutcomeMessage("duplicate")).toMatch(/zaten/);
  });
});
