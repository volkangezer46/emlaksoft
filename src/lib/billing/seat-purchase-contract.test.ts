import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Sözleşme: koltuk satışı hazırlık kontrolü olmadan para tahsil eden yol OLUŞMAZ. */
describe("koltuk satın alma sözleşmesi", () => {
  const billing = read("src/app/actions/billing.ts");
  const start = billing.indexOf("export async function startSeatPurchase");
  const body = billing.slice(start);

  it("action var ve izin + rol + hız sınırı + hazırlık kapısı sırasıyla çalışır", () => {
    expect(start).toBeGreaterThan(0);
    const order = [
      'requirePermission("billing", "edit")',
      'gate.role !== "owner" && gate.role !== "gm"',
      "checkRateLimit(`seatbuy:",
      "support.purchaseReady",
      "isIyzicoConfigured()",
      "evaluateSeatChange(",
      "createSeatInvoice(",
      "initializeCheckoutForm(",
    ].map((needle) => body.indexOf(needle));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("istemciden tutar alınmaz; demo ödeme yolu yoktur", () => {
    expect(body).not.toMatch(/formData\.get\("(amount|price|total|charge)/);
    expect(body).not.toContain("fulfillSuccessfulPayment");
    expect(body).toContain("logActivity(");
  });

  it("istemci paneli sunucu modülü import etmez", () => {
    const panel = read("src/app/app/abonelik/seat-panel.tsx");
    expect(panel.startsWith('"use client";')).toBe(true);
    expect(panel).not.toMatch(/from "@\/lib\/billing\/seat-purchase"/);
    expect(panel).not.toMatch(/from "@\/lib\/supabase\//);
    expect(panel).not.toMatch(/Date\.now\(|new Date\(/);
  });

  it("ekip aksiyonu etkin limiti (plan + ek) kullanır ve koltuk bağlantısı verir", () => {
    const team = read("src/app/actions/team.ts");
    expect(team).toContain("getExtraSeats(");
    expect(team).toContain("/app/abonelik#koltuk");
  });
});
