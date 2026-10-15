import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEDGER_STATUS_FILTERS, parseLedgerFilter } from "@/lib/accounting/ledger";
import { resolvePeriod } from "@/lib/accounting/period";

/**
 * SK6/B111 sözleşmesi: billing-home'daki her fatura kartı, hedef sayfanın KABUL ETTİĞİ bir süzgeç taşır.
 * - Fatura kümesi (ödenen / açık / gecikmiş / son faturalar) → /admin/billing/defter (durum ∈ LEDGER_STATUS_FILTERS, donem preset).
 * - /admin/billing yalnız ABONELİK durumlarını süzer (trialing/active/past_due/cancelled/paused); fatura durumu oraya gitmez.
 */
const root = process.cwd();
const src = readFileSync(path.join(root, "src/app/admin/_dashboards/billing-home.tsx"), "utf8");
const billingPage = readFileSync(path.join(root, "src/app/admin/billing/page.tsx"), "utf8");

const literals = [...src.matchAll(/["'`](\/admin\/billing[^"'`$]*)/g)].map((m) => m[1]!);
const subStatusBlock = billingPage.slice(billingPage.indexOf("const subStatus"), billingPage.indexOf("};", billingPage.indexOf("const subStatus")));
const subscriptionStatuses = [...subStatusBlock.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]!);
const NOW = Date.parse("2026-10-15T09:00:00Z");

describe("billing-home fatura kartı bağlantıları", () => {
  it("abonelik durum listesi okunabildi (sözleşme kendini doğrular)", () => {
    expect(subscriptionStatuses).toEqual(expect.arrayContaining(["trialing", "active", "past_due", "cancelled", "paused"]));
    expect(literals.length).toBeGreaterThan(3);
  });

  it("defter bağlantıları defterin kabul ettiği durum ve dönemi taşır", () => {
    const ledger = literals.filter((h) => h.startsWith("/admin/billing/defter"));
    expect(ledger.length).toBeGreaterThanOrEqual(4);
    for (const href of ledger) {
      const params = Object.fromEntries(new URL(href, "https://x.invalid").searchParams);
      expect(params.donem, href).toBeDefined();
      // Geçersiz preset sessizce "bu ay"a düşer: verilen preset aynen çözülmeli.
      expect(resolvePeriod(params, NOW).preset, href).toBe(params.donem);
      if (params.durum !== undefined) {
        expect(LEDGER_STATUS_FILTERS as readonly string[], href).toContain(params.durum);
        expect(parseLedgerFilter(params).durum, href).toBe(params.durum);
      }
    }
    // Ödenen, açık ve gecikmiş fatura kümelerinin her biri bir karta bağlı.
    const statuses = new Set(ledger.map((h) => new URL(h, "https://x.invalid").searchParams.get("durum")));
    for (const s of ["paid", "open", "gecikmis"]) expect(statuses).toContain(s);
  });

  it("/admin/billing bağlantıları yalnız abonelik durumu taşır (fatura durumu 'paid'/'open' oraya gitmez)", () => {
    const billing = literals.filter((h) => h.startsWith("/admin/billing?"));
    for (const href of billing) {
      const durum = new URL(href, "https://x.invalid").searchParams.get("durum");
      expect(subscriptionStatuses, href).toContain(durum);
    }
    expect(src).not.toMatch(/\/admin\/billing\?durum=(paid|open)\b/);
  });
});
