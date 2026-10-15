import { describe, expect, it } from "vitest";
import { compareOfferBadges, parseOfferTerms, pctOfList, readOfferTerms, EMPTY_OFFER_TERMS, type ComparableOffer } from "./offer-terms";

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseOfferTerms", () => {
  it("alan yoksa dokunmaz (present=false)", () => {
    const r = parseOfferTerms(fd({ amount: "100" }));
    expect(r).toEqual({ ok: true, present: false, value: EMPTY_OFFER_TERMS });
  });

  it("Türkçe biçimli kapora, tarih, kredi şartı ve takas notunu ayrıştırır", () => {
    const r = parseOfferTerms(
      fd({ payment_method: "karma", deposit_amount: "250.000", proposed_deed_date: "2026-11-20", credit_contingency: "on", swap_note: " 2019 model araç " }),
      { offerAmount: 5_000_000, todayKey: "2026-10-15" },
    );
    expect(r).toEqual({
      ok: true,
      present: true,
      value: { payment_method: "karma", deposit_amount: 250000, proposed_deed_date: "2026-11-20", credit_contingency: true, swap_note: "2019 model araç" },
    });
  });

  it("virgüllü ondalık kapora", () => {
    const r = parseOfferTerms(fd({ deposit_amount: "1.250,50" }));
    expect(r.ok && r.value.deposit_amount).toBe(1250.5);
  });

  it("geçersiz girdileri reddeder", () => {
    expect(parseOfferTerms(fd({ payment_method: "bitcoin" })).ok).toBe(false);
    expect(parseOfferTerms(fd({ deposit_amount: "abc" })).ok).toBe(false);
    expect(parseOfferTerms(fd({ deposit_amount: "600" }), { offerAmount: 500 })).toEqual({ ok: false, error: "Kapora, teklif tutarından büyük olamaz." });
    expect(parseOfferTerms(fd({ proposed_deed_date: "2026-02-30" })).ok).toBe(false);
    expect(parseOfferTerms(fd({ proposed_deed_date: "2026-10-01" }), { todayKey: "2026-10-15" }).ok).toBe(false);
    expect(parseOfferTerms(fd({ swap_note: "x".repeat(1001) })).ok).toBe(false);
  });
});

describe("readOfferTerms", () => {
  it("eksik/yanlış sütunlarda varsayılana düşer", () => {
    expect(readOfferTerms(null)).toEqual(EMPTY_OFFER_TERMS);
    expect(readOfferTerms({ payment_method: "x", deposit_amount: "1000.00", proposed_deed_date: "2026-11-01T00:00:00", credit_contingency: true })).toEqual({
      payment_method: null,
      deposit_amount: 1000,
      proposed_deed_date: "2026-11-01",
      credit_contingency: true,
      swap_note: null,
    });
  });
});

describe("compareOfferBadges", () => {
  const offer = (id: string, amount: number, terms: Partial<ComparableOffer["terms"]> = {}): ComparableOffer => ({
    id,
    amount,
    status: "submitted",
    valid_until: null,
    terms: { ...EMPTY_OFFER_TERMS, ...terms },
  });

  it("tek teklifte rozet yok", () => {
    expect(compareOfferBadges([offer("a", 100)]).get("a")).toEqual([]);
  });

  it("tekil kazanana olgusal rozetler", () => {
    const b = compareOfferBadges([
      offer("a", 5_000_000, { payment_method: "kredi", credit_contingency: true, deposit_amount: 100_000, proposed_deed_date: "2026-12-01" }),
      offer("b", 4_800_000, { payment_method: "pesin", deposit_amount: 300_000, proposed_deed_date: "2026-11-10" }),
      offer("c", 4_700_000),
    ]);
    expect(b.get("a")).toEqual(["highest_amount"]);
    expect(b.get("b")).toEqual(["highest_deposit", "earliest_deed", "no_credit_condition"]);
    expect(b.get("c")).toEqual([]);
  });

  it("eşitlikte rozet verilmez; kredi şartlı teklif yoksa 'kredi şartı yok' verilmez", () => {
    const b = compareOfferBadges([offer("a", 100, { payment_method: "pesin" }), offer("b", 100, { payment_method: "pesin" })]);
    expect(b.get("a")).toEqual([]);
    expect(b.get("b")).toEqual([]);
  });
});

describe("pctOfList", () => {
  it("ilan fiyatına göre yüzde", () => {
    expect(pctOfList(950, 1000)).toBe(-5);
    expect(pctOfList(1000, null)).toBeNull();
  });
});
