import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gateRef = vi.hoisted(() => ({
  value: { ok: true, userId: "u1", tenantId: "11111111-2222-3333-4444-555555555555", role: "owner", impersonating: false } as Record<string, unknown>,
}));
const ready = vi.hoisted(() => ({ ok: true }));
const iyz = vi.hoisted(() => ({ configured: true }));
const rate = vi.hoisted(() => ({ allowed: true }));
const createInvoice = vi.hoisted(() => vi.fn(async (i: { pack: { units: number; priceNetTry: number } }) => ({ invoiceId: "inv-1", totalTry: i.pack.priceNetTry * 1.2 })));
const initCheckout = vi.hoisted(() => vi.fn(async () => ({ status: "success", paymentPageUrl: "https://pay.example/x" })));
const packs = vi.hoisted(() => ({
  list: [
    { id: "mini", name: "Mini", units: 10, priceNetTry: 175, active: true, order: 10 },
    { id: "eski", name: "Eski", units: 5, priceNetTry: 90, active: false, order: 20 },
  ],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => gateRef.value }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: rate.allowed }), clientIp: async () => "1.2.3.4" }));
vi.mock("@/lib/ef-credits/credit-reader", () => ({
  getEfCreditReady: async () => ready.ok,
  getEfCatalog: async () => ({ tariff: {}, packs: packs.list }),
}));
vi.mock("@/lib/billing/credit-pack-purchase", () => ({ createCreditPackInvoice: createInvoice }));
vi.mock("@/lib/billing/iyzico", () => ({
  IYZICO_CURRENCY: "TRY",
  isIyzicoConfigured: () => iyz.configured,
  initializeCheckoutForm: initCheckout,
}));
vi.mock("@/lib/billing/fulfillment", () => ({
  assertBillingPlanPreflight: vi.fn(),
  createCheckoutInvoice: vi.fn(),
  fulfillSuccessfulPayment: vi.fn(),
  invoiceAmountsTry: (n: number) => ({ amountTry: n, taxTry: n * 0.2, totalTry: Math.round(n * 1.2 * 100) / 100 }),
  markCheckoutInvoiceFailed: vi.fn(),
  markCheckoutInvoiceInitialized: vi.fn(),
}));
vi.mock("@/lib/billing/buyer", () => ({ validateCheckoutBuyer: () => ({ buyer: {}, billingAddress: {} }) }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/billing/coupon-server", () => ({ quoteCoupon: vi.fn(), redeemCoupon: vi.fn() }));
vi.mock("@/lib/billing/seat-purchase", () => ({ createSeatInvoice: vi.fn(), getSeatSupport: vi.fn(), loadSeatState: vi.fn() }));
vi.mock("@/lib/billing/plan-definitions", () => ({ getPlanDefinition: vi.fn(), getPlanDefinitions: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "a@b.co" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "t", phone: "x" } }) }) }) }),
  }),
}));

import { startCreditPackPurchase } from "@/app/actions/billing";

function fd(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}
const OWNER = { ok: true, userId: "u1", tenantId: "11111111-2222-3333-4444-555555555555", role: "owner", impersonating: false };

describe("startCreditPackPurchase kapıları", () => {
  beforeEach(() => {
    gateRef.value = { ...OWNER };
    ready.ok = true;
    iyz.configured = true;
    rate.allowed = true;
    createInvoice.mockClear();
    initCheckout.mockClear();
  });

  it("izin yoksa reddeder", async () => {
    gateRef.value = { ok: false, error: "Bu işlem için yetkiniz yok." };
    expect((await startCreditPackPurchase(fd({ pack_id: "mini" }))).error).toMatch(/yetkiniz/);
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("owner/gm dışı satın alamaz", async () => {
    for (const role of ["agent", "manager", "accountant"]) {
      gateRef.value = { ...OWNER, role };
      expect((await startCreditPackPurchase(fd({ pack_id: "mini" }))).error).toMatch(/ofis sahibi/);
    }
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("destek oturumu reddedilir", async () => {
    gateRef.value = { ...OWNER, impersonating: true };
    expect((await startCreditPackPurchase(fd({ pack_id: "mini" }))).error).toMatch(/Destek oturumunda/);
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("hız sınırı", async () => {
    rate.allowed = false;
    expect((await startCreditPackPurchase(fd({ pack_id: "mini" }))).error).toMatch(/Çok fazla/);
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("ef_credit_ready kapalıyken para tahsil yolu AÇILMAZ", async () => {
    ready.ok = false;
    expect((await startCreditPackPurchase(fd({ pack_id: "mini" }))).error).toMatch(/etkin değil/);
    expect(createInvoice).not.toHaveBeenCalled();
    expect(initCheckout).not.toHaveBeenCalled();
  });
  it("iyzico yoksa demo yok: reddeder", async () => {
    iyz.configured = false;
    expect((await startCreditPackPurchase(fd({ pack_id: "mini" }))).error).toMatch(/yapılandırılmamış/);
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("kupon kontör paketine uygulanmaz", async () => {
    expect((await startCreditPackPurchase(fd({ pack_id: "mini", coupon: "ABC" }))).error).toMatch(/Kupon/);
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("pasif/bilinmeyen paket ve geçersiz kimlik reddedilir", async () => {
    expect((await startCreditPackPurchase(fd({ pack_id: "eski" }))).error).toMatch(/satışta değil/);
    expect((await startCreditPackPurchase(fd({ pack_id: "yok-paket" }))).error).toMatch(/satışta değil/);
    expect((await startCreditPackPurchase(fd({ pack_id: "../x" }))).error).toMatch(/Geçersiz/);
    expect(createInvoice).not.toHaveBeenCalled();
  });
  it("istemci tutarı/kontörü YOK SAYILIR: fatura katalogdaki paketle açılır", async () => {
    const r = await startCreditPackPurchase(fd({ pack_id: "mini", units: "9999", amount: "1", price: "1", priceNetTry: "1" }));
    expect(r.checkoutUrl).toBe("https://pay.example/x");
    const arg = createInvoice.mock.calls[0]![0] as { pack: { id: string; units: number; priceNetTry: number } };
    expect(arg.pack).toMatchObject({ id: "mini", units: 10, priceNetTry: 175 });
    expect(initCheckout).toHaveBeenCalledWith(expect.objectContaining({ price: 210, paidPrice: 210 }));
  });
  it("ekrandaki tutar değiştiyse yeniden onay ister, fatura açmaz", async () => {
    const r = await startCreditPackPurchase(fd({ pack_id: "mini", confirm_try: "100" }));
    expect(r.error).toMatch(/Tutar güncellendi/);
    expect(r.quotedTotalTry).toBe(210);
    expect(createInvoice).not.toHaveBeenCalled();
  });
});

describe("kontör satın alma kaynak sözleşmesi", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const billing = read("src/app/actions/billing.ts");
  const body = billing.slice(billing.indexOf("export async function startCreditPackPurchase"));

  it("kapı sırası", () => {
    const order = [
      'requirePermission("billing", "edit")',
      "gate.impersonating",
      'gate.role !== "owner" && gate.role !== "gm"',
      "checkRateLimit(`efpack:",
      "getEfCreditReady()",
      "isIyzicoConfigured()",
      "findPurchasablePack(",
      "createCreditPackInvoice(",
      "logActivity(",
      "initializeCheckoutForm(",
    ].map((n) => body.indexOf(n));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("demo ödeme ve istemci tutarı yok", () => {
    expect(body).not.toContain("fulfillSuccessfulPayment");
    expect(body).not.toMatch(/formData\.get\("(amount|price|total|units)/);
  });
  it("istemci paneli sunucu modülü import etmez; fatura meta sözleşmesi", () => {
    const panel = read("src/app/app/abonelik/kontor-panel.tsx");
    expect(panel.startsWith('"use client";')).toBe(true);
    expect(panel).not.toMatch(/from "@\/lib\/(billing\/credit-pack-purchase"|supabase\/|ef-credits\/credit-reader)/);
    expect(panel).not.toMatch(/Date\.now\(|new Date\(/);
    expect(read("src/lib/billing/credit-pack-purchase.ts")).toContain("buildCreditPackMeta(");
  });
  it("admin sayfası ve ofis bölümü saat/piksel kurallarına uyar", () => {
    for (const f of ["src/app/admin/ef-kontor/page.tsx", "src/app/admin/ef-kontor/editors.tsx", "src/app/app/abonelik/kontor-section.tsx", "src/app/app/abonelik/kontor-panel.tsx"]) {
      const s = read(f);
      expect(s).not.toMatch(/Date\.now\(|new Date\(/);
      expect(s).not.toMatch(/text-\[\d+px\]/);
    }
  });
});
