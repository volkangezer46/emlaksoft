import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getPlatformSetting = vi.fn();
vi.mock("@/lib/platform-settings", () => ({ getPlatformSetting: (k: string) => getPlatformSetting(k) }));
const chargeStoredCard = vi.fn();
vi.mock("@/lib/billing/iyzico", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/iyzico")>()),
  isIyzicoConfigured: () => true,
  chargeStoredCard: (...a: unknown[]) => chargeStoredCard(...a),
}));
vi.mock("@/lib/billing/fulfillment", () => ({
  createCheckoutInvoice: vi.fn(),
  fulfillSuccessfulPayment: vi.fn(),
  invoiceAmountsTry: vi.fn(),
  markCheckoutInvoiceFailed: vi.fn(),
}));
vi.mock("@/lib/notify-batch", () => ({ insertNotifications: vi.fn() }));

import { runAutoRenewPass } from "./auto-renew";

describe("otomatik yenileme: KAPALI bayrak", () => {
  beforeEach(() => {
    getPlatformSetting.mockReset();
    chargeStoredCard.mockReset();
  });

  it.each([null, "", "false", "0", "yes"])("bayrak %j iken hiçbir sorgu/ödeme çağrısı yapılmaz", async (flag) => {
    getPlatformSetting.mockResolvedValue(flag);
    const from = vi.fn();
    const admin = { from, auth: { admin: { getUserById: vi.fn() } } } as never;
    const res = await runAutoRenewPass(admin, 1_000);
    expect(res).toEqual({ enabled: false, attempted: 0, charged: 0, failed: 0, skipped: 0 });
    expect(from).not.toHaveBeenCalled();
    expect(chargeStoredCard).not.toHaveBeenCalled();
    expect(getPlatformSetting).toHaveBeenCalledWith("billing.auto_renew_enabled");
  });

  it("bayrak açık ama rıza veren ofis yoksa ödeme çağrısı yapılmaz", async () => {
    getPlatformSetting.mockResolvedValue("true");
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not"]) chain[m] = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    const admin = { from: () => chain } as never;
    const res = await runAutoRenewPass(admin, 1_000);
    expect(res.enabled).toBe(true);
    expect(res.attempted).toBe(0);
    expect(chargeStoredCard).not.toHaveBeenCalled();
  });
});
