import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GP2: iyzico callback tutar doğrulaması faturanın KESİLDİĞİ andaki KDV oranıyla yapılır (meta.vatRate; yoksa %20).
 * KDV ayarı sonradan değişse de bekleyen ödeme doğrulanır; faturadaki oranla tutmayan toplamlar reddedilir.
 */
const h = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  verify: vi.fn(),
  fulfill: vi.fn(),
}));

vi.mock("@/lib/billing/iyzico", () => ({
  IYZICO_CURRENCY: "TRY",
  isIyzicoConfigured: () => true,
  retrieveCheckoutForm: async () => ({ status: "success", paymentStatus: "SUCCESS", conversationId: "es-conv-1" }),
  verifyCheckoutPayment: (...a: unknown[]) => h.verify(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "filter", "order", "limit"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: h.invoice, error: null });
    return { from: () => chain };
  },
}));
vi.mock("@/lib/billing/fulfillment", async () => ({
  fulfillSuccessfulPayment: (...a: unknown[]) => h.fulfill(...a),
  invoiceAmountsTry: (await import("@/lib/billing/invoice-amounts")).invoiceAmountsTry,
}));
vi.mock("@/lib/try-credits/wallet", () => ({ tryInvoiceHold: async () => ({ has_hold: false }) }));
vi.mock("@/lib/billing/payment-link-fulfill", () => ({ fulfillPaymentLinkByConversation: vi.fn() }));
vi.mock("@/lib/billing/card-store", () => ({ saveCardAfterVerifiedPayment: vi.fn() }));
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://example.test" }));

import { GET } from "./route";
import { invoiceAmountsTry } from "@/lib/billing/invoice-amounts";

function invoiceRow(net: number, rate: number | null) {
  const a = invoiceAmountsTry(net, rate ?? undefined);
  return {
    tenant_id: "t1",
    amount_try: a.amountTry,
    tax_try: a.taxTry,
    total_try: a.totalTry,
    currency: "TRY",
    meta: { plan: "office", cycle: "monthly", conversationId: "es-conv-1", ...(rate === null ? {} : { vatRate: rate }) },
  };
}

const run = async () => (await GET(new NextRequest("http://localhost/api/iyzico/callback?token=t"))).headers.get("location");

describe("iyzico callback: KDV oranı değişimi", () => {
  beforeEach(() => {
    h.verify.mockReset().mockImplementation((_r: unknown, exp: { amountTry: number }) => ({ paymentId: "p1", amountTry: exp.amountTry, currency: "TRY" }));
    h.fulfill.mockReset().mockResolvedValue({ ok: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("%18 ile kesilmiş fatura, ayar başka orana geçse de kendi oranıyla doğrulanır", async () => {
    h.invoice = invoiceRow(2490, 0.18);
    expect(await run()).toBe("https://example.test/app/abonelik?paid=1&plan=office");
    expect(h.verify.mock.calls[0]![1]).toMatchObject({ amountTry: 2938.2 });
    expect(h.fulfill.mock.calls[0]![0]).toMatchObject({ expectedAmountTry: 2938.2 });
  });

  it("oranı yazılmamış eski fatura %20 ile doğrulanmaya devam eder", async () => {
    h.invoice = invoiceRow(2490, null);
    expect(await run()).toBe("https://example.test/app/abonelik?paid=1&plan=office");
    expect(h.verify.mock.calls[0]![1]).toMatchObject({ amountTry: 2988 });
  });

  it("faturadaki oranla tutmayan toplamlar reddedilir (tahsilat tamamlanmaz)", async () => {
    h.invoice = { ...invoiceRow(2490, null), meta: { plan: "office", cycle: "monthly", vatRate: 0.18 } };
    expect(await run()).toBe("https://example.test/app/abonelik?error=callback");
    expect(h.fulfill).not.toHaveBeenCalled();
  });
});
