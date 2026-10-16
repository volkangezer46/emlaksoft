import { describe, expect, it } from "vitest";
import { confirmationAgeDays, confirmationHealth, isConfirmationOverdue } from "./listing-confirmation";

const NOW = Date.UTC(2026, 9, 16, 12);
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("ilan teyit sağlığı — tek tanım", () => {
  it("teyit damgası yoksa yayın anından yaşlanır (taze ilan anında gecikmiş sayılmaz)", () => {
    expect(isConfirmationOverdue({ last_confirmed_at: null, published_at: ago(2) }, NOW)).toBe(false);
    expect(isConfirmationOverdue({ last_confirmed_at: null, published_at: null, created_at: ago(9) }, NOW)).toBe(true);
    expect(confirmationAgeDays({ last_confirmed_at: null }, NOW)).toBe(Number.POSITIVE_INFINITY);
  });
  it("7 gün ve üstü teyitsiz → bekliyor", () => {
    expect(isConfirmationOverdue({ last_confirmed_at: ago(6.9) }, NOW)).toBe(false);
    expect(isConfirmationOverdue({ last_confirmed_at: ago(7) }, NOW)).toBe(true);
  });
  it("yüzde bir ondalık; ilan yoksa sağlık yok (null)", () => {
    expect(confirmationHealth([], NOW)).toEqual({ total: 0, overdue: 0, pct: null });
    const h = confirmationHealth([{ last_confirmed_at: ago(1) }, { last_confirmed_at: ago(1) }, { last_confirmed_at: ago(10) }], NOW);
    expect(h).toEqual({ total: 3, overdue: 1, pct: 66.7 });
  });
});
