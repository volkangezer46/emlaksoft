import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * startPlanCheckout + startCreditPackPurchase (actions/billing.ts) hata yolları — mock Supabase / iyzico / fulfillment.
 * Odak (para akışı): her hata yolunda taslak fatura 'failed' işaretlenir ve iyzico/fulfill çağrısı SIZMAZ; tutar istemciden alınmaz;
 * kupon/hesap kredisi/kayıtlı kart yalnız yetkili rollerle; EF (kontör) satışı hazır değilse PARA ALINMAZ.
 */
const h = vi.hoisted(() => ({
  gate: { ok: true, userId: "u1", tenantId: "12345678-aaaa-bbbb-cccc-000000000000", role: "owner", impersonating: false } as
    | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
    | { ok: false; error: string },
  user: true,
  tenant: { id: "t1", name: "Ofis", plan: "office", tax_number: "1234567890", phone: "05321234567", address_line: "x", city: "Ankara" } as Record<string, unknown> | null,
  rateAllowed: true,
  configured: true,
  planHidden: false,
  preflight: vi.fn(),
  quoteCoupon: vi.fn(),
  redeemCoupon: vi.fn(),
  buyer: vi.fn(),
  createInvoice: vi.fn(),
  fulfillDemo: vi.fn(),
  fulfillCredit: vi.fn(),
  markFailed: vi.fn(),
  markInitialized: vi.fn(),
  initCheckout: vi.fn(),
  logActivity: vi.fn(),
  cardKey: vi.fn(),
  efPurchasable: true,
  efReady: true,
  efLotsReady: true,
  pack: { id: "p100", name: "100 kontör", units: 100, priceNetTry: 990 } as Record<string, unknown> | null,
  packInvoice: vi.fn(),
  // Oransal yukseltme / duraklatma kapilari (varsayilan KAPALI: eski akis aynen).
  changeState: null as Record<string, unknown> | null,
  changeEnabled: false,
  upgradeReady: false,
  plans: [] as Record<string, unknown>[],
}));

function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = () => c;
  c.maybeSingle = async () => {
    if (table === "tenants") return { data: h.tenant, error: null };
    if (table === "profiles") return { data: { full_name: "Ayşe Yılmaz", phone: "05321234567" }, error: null };
    return { data: { id: "sub1" }, error: null };
  };
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => h.gate }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user ? { id: "u1", email: "ayse@example.com" } : null } }) },
    from: (t: string) => chain(t),
  }),
}));
vi.mock("@/lib/billing/plan-definitions", () => ({
  getPlanDefinition: async () => ({ id: "office", monthlyTry: 2490, yearlyPaidMonths: 10, hidden: h.planHidden }),
  getPlanDefinitions: async () => h.plans,
}));
vi.mock("@/lib/billing/plan-change", () => ({
  isPlanChangeEnabled: async () => h.changeEnabled,
  loadPlanChangeState: async () => h.changeState,
}));
vi.mock("@/lib/billing/plan-support", () => ({ getPlanSupport: async () => ({ upgradeReady: h.upgradeReady }) }));
vi.mock("@/lib/billing/seat-purchase-core", () => ({ evaluateSeatChange: vi.fn() }));
vi.mock("@/lib/billing/seat-purchase", () => ({ createSeatInvoice: vi.fn(), getSeatSupport: vi.fn(), loadSeatState: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: h.logActivity }));
vi.mock("@/lib/billing/coupon-server", () => ({ quoteCoupon: h.quoteCoupon, redeemCoupon: h.redeemCoupon }));
vi.mock("@/lib/billing/iyzico", () => ({
  IYZICO_CURRENCY: "TRY",
  initializeCheckoutForm: h.initCheckout,
  isIyzicoConfigured: () => h.configured,
}));
vi.mock("@/lib/billing/fulfillment", () => ({
  assertBillingPlanPreflight: h.preflight,
  createCheckoutInvoice: h.createInvoice,
  fulfillInvoiceWithWalletCredit: h.fulfillCredit,
  fulfillSuccessfulPayment: h.fulfillDemo,
  invoiceAmountsTry: (amount: number) => ({ netTry: amount, totalTry: Math.round(amount * 1.2 * 100) / 100 }),
  markCheckoutInvoiceFailed: h.markFailed,
  markCheckoutInvoiceInitialized: h.markInitialized,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: h.rateAllowed }),
  clientIp: async () => "203.0.113.7",
}));
vi.mock("@/lib/billing/buyer", () => ({ validateCheckoutBuyer: h.buyer }));
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/billing/card-store", () => ({ getTenantCardUserKey: h.cardKey }));
vi.mock("@/lib/billing/credit-pack-purchase", () => ({ createCreditPackInvoice: h.packInvoice }));
vi.mock("@/lib/billing/credit-pack-purchase-core", () => ({
  creditPackBasketName: () => "100 kontör",
  findPurchasablePack: () => h.pack,
  quoteCreditPack: () => ({ totalTry: 1188 }),
}));
vi.mock("@/lib/ef-credits/credit-reader", () => ({
  getEfCatalog: async () => ({ packs: [h.pack] }),
  getEfCreditReady: async () => h.efReady,
  getEfLotsReady: async () => h.efLotsReady,
}));
vi.mock("@/lib/ef-credits/public-state", () => ({
  EF_PURCHASE_CLOSED_MESSAGE: "EF satışı kapalı.",
  getEfPublicState: async () => ({ purchasable: h.efPurchasable }),
}));
vi.mock("@/lib/try-credits/settings", () => ({ getTryMaxShare: async () => 0.5 }));

import { ActionUserError } from "@/lib/action-errors";
import { startCreditPackPurchase, startPlanCheckout } from "./billing";

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const base: Record<string, string> = { plan: "office", cycle: "monthly", ...over };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.gate = { ok: true, userId: "u1", tenantId: "12345678-aaaa-bbbb-cccc-000000000000", role: "owner", impersonating: false };
  h.user = true;
  h.tenant = { id: "t1", name: "Ofis", plan: "office", tax_number: "1234567890", phone: "05321234567", address_line: "x", city: "Ankara" };
  h.rateAllowed = true;
  h.configured = true;
  h.planHidden = false;
  h.efPurchasable = true;
  h.efReady = true;
  h.efLotsReady = true;
  h.pack = { id: "p100", name: "100 kontör", units: 100, priceNetTry: 990 };
  h.changeState = null;
  h.changeEnabled = false;
  h.upgradeReady = false;
  h.plans = [];
  h.preflight.mockResolvedValue(undefined);
  h.quoteCoupon.mockResolvedValue({ ok: true, code: "YAZ10", discountTry: 249 });
  h.redeemCoupon.mockResolvedValue({ ok: true, discountTry: 249 });
  h.buyer.mockReturnValue({ buyer: { id: "u1" }, billingAddress: { city: "Ankara" } });
  h.createInvoice.mockResolvedValue({ invoiceId: "inv-1", credit: null });
  h.fulfillDemo.mockResolvedValue(undefined);
  h.fulfillCredit.mockResolvedValue(undefined);
  h.markFailed.mockResolvedValue(undefined);
  h.markInitialized.mockResolvedValue(undefined);
  h.initCheckout.mockResolvedValue({ status: "success", paymentPageUrl: "https://iyzico.test/pay" });
  h.cardKey.mockResolvedValue("card-user-key");
  h.packInvoice.mockResolvedValue({ invoiceId: "inv-pack", totalTry: 1188, credit: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startPlanCheckout — ön kapılar", () => {
  it("izin kapısı, geçersiz paket/dönem", async () => {
    h.gate = { ok: false, error: "Yetkiniz yok." };
    expect(await startPlanCheckout(form())).toEqual({ error: "Yetkiniz yok." });
    h.gate = { ok: true, userId: "u1", tenantId: "12345678-x", role: "owner", impersonating: false };
    expect((await startPlanCheckout(form({ plan: "bedava" }))).error).toBe("Geçersiz paket.");
    expect((await startPlanCheckout(form({ cycle: "weekly" }))).error).toBe("Geçersiz dönem.");
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("hesap kredisi ve kart kaydı yalnız owner/gm", async () => {
    h.gate = { ok: true, userId: "u1", tenantId: "12345678-x", role: "accounting", impersonating: false };
    expect((await startPlanCheckout(form({ use_credit: "1" }))).error).toMatch(/ofis sahibi veya genel müdür/);
    expect((await startPlanCheckout(form({ save_card: "1" }))).error).toMatch(/ofis sahibi veya genel müdür/);
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("oturum yok / ofis yok / paket ön kontrolü (kapasite) / gizli paket", async () => {
    h.user = false;
    expect((await startPlanCheckout(form())).error).toBe("Oturum bulunamadı.");
    h.user = true;
    h.tenant = null;
    expect((await startPlanCheckout(form())).error).toBe("Ofis bulunamadı.");
    h.tenant = { id: "t1", name: "Ofis", plan: "office" };
    h.preflight.mockRejectedValue(new ActionUserError("Aktif kullanıcı sayınız bu paketin sınırını aşıyor."));
    expect((await startPlanCheckout(form())).error).toMatch(/sınırını aşıyor/);
    h.preflight.mockResolvedValue(undefined);
    h.planHidden = true;
    expect((await startPlanCheckout(form())).error).toMatch(/çevrimiçi satın alınamıyor/);
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(h.initCheckout).not.toHaveBeenCalled();
  });
});

describe("startPlanCheckout — duraklatma ve oransal paket değişikliği kapıları", () => {
  const DAY = 86_400_000;
  const plans = [
    { id: "office", name: "Ofis", monthlyTry: 2490, yearlyPaidMonths: 10, limits: { seats: 5 } },
    { id: "professional", name: "Profesyonel", monthlyTry: 4990, yearlyPaidMonths: 10, limits: { seats: 15 } },
    { id: "advisor", name: "Danışman", monthlyTry: 749, yearlyPaidMonths: 10, limits: { seats: 1 } },
  ];
  const active = (over: Record<string, unknown> = {}) => ({
    status: "active",
    planId: "office",
    cycle: "monthly",
    lockedMonthlyTry: null,
    periodStartMs: Date.now() - 15 * DAY,
    periodEndMs: Date.now() + 15 * DAY,
    pause: { paused: false },
    ...over,
  });

  it("duraklatılmış abonelikte ödeme/fatura AÇILMAZ", async () => {
    h.changeState = active({ pause: { paused: true } });
    expect((await startPlanCheckout(form())).error).toMatch(/duraklatıldı/);
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(h.initCheckout).not.toHaveBeenCalled();
  });

  it("bayrak KAPALI: aktif abonelikte paket değişimi eski akışla (tam fiyat) devam eder", async () => {
    h.plans = plans;
    h.changeState = active();
    h.changeEnabled = false;
    h.upgradeReady = true;
    const r = await startPlanCheckout(form({ plan: "professional" }));
    expect(r.checkoutUrl).toBe("https://iyzico.test/pay");
    expect(h.createInvoice).toHaveBeenCalledTimes(1);
  });

  it("şema hazır değilken (upgradeReady=false) bayrak açık olsa da eski akış", async () => {
    h.plans = plans;
    h.changeState = active();
    h.changeEnabled = true;
    h.upgradeReady = false;
    expect((await startPlanCheckout(form({ plan: "professional" }))).checkoutUrl).toBe("https://iyzico.test/pay");
  });

  it("bayrak + hazırlık açık: yükseltme oransal yola, düşürme planlı yola yönlendirilir; fatura AÇILMAZ", async () => {
    h.plans = plans;
    h.changeEnabled = true;
    h.upgradeReady = true;
    h.changeState = active({ periodStartMs: Date.now() - 15 * DAY, periodEndMs: Date.now() + 15 * DAY });
    expect((await startPlanCheckout(form({ plan: "professional" }))).error).toMatch(/Oransal yükselt/);
    expect((await startPlanCheckout(form({ plan: "advisor" }))).error).toMatch(/Dönem sonunda geç/);
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(h.initCheckout).not.toHaveBeenCalled();
  });

  it("aynı paketi yenileme (Yenile / öde) bayrak açıkken de serbest", async () => {
    h.plans = plans;
    h.changeEnabled = true;
    h.upgradeReady = true;
    h.changeState = active({ periodStartMs: Date.now() - 15 * DAY, periodEndMs: Date.now() + 15 * DAY });
    expect((await startPlanCheckout(form({ plan: "office" }))).checkoutUrl).toBe("https://iyzico.test/pay");
  });
});

describe("startPlanCheckout — kupon", () => {
  it("geçersiz kupon: fatura oluşturulmaz", async () => {
    h.quoteCoupon.mockResolvedValue({ ok: false, error: "Kupon süresi dolmuş." });
    expect((await startPlanCheckout(form({ coupon: "ESKI" }))).error).toBe("Kupon süresi dolmuş.");
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("geçerli kupon: tutar sunucuda indirimle hesaplanır (istemci tutarı yok sayılır); redeem faturayla bağlanır", async () => {
    const f = form({ coupon: "yaz10", amount: "1" }); // istemci tutar göndermeye çalışır: yok sayılır
    const r = await startPlanCheckout(f);
    expect(r.checkoutUrl).toBe("https://iyzico.test/pay");
    expect(h.quoteCoupon).toHaveBeenCalledWith("yaz10", "office", 2490);
    expect(h.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ amountTry: 2241, plan: "office", cycle: "monthly" }));
    expect(h.redeemCoupon).toHaveBeenCalledWith(expect.objectContaining({ code: "YAZ10", invoiceId: "inv-1", baseAmountTry: 2490 }));
  });

  it("redeem başarısız ya da indirim değişmiş: taslak fatura 'failed' işaretlenir, iyzico ÇAĞRILMAZ", async () => {
    h.redeemCoupon.mockResolvedValue({ ok: false, error: "Kupon tükendi." });
    expect((await startPlanCheckout(form({ coupon: "YAZ10" }))).error).toBe("Kupon tükendi.");
    expect(h.markFailed).toHaveBeenCalledWith({ invoiceId: "inv-1", tenantId: h.gate.ok ? h.gate.tenantId : "" });
    h.markFailed.mockClear();
    h.redeemCoupon.mockResolvedValue({ ok: true, discountTry: 100 });
    expect((await startPlanCheckout(form({ coupon: "YAZ10" }))).error).toMatch(/Kupon tutarı değişti/);
    expect(h.markFailed).toHaveBeenCalledTimes(1);
    expect(h.initCheckout).not.toHaveBeenCalled();
  });
});

describe("startPlanCheckout — ödeme altyapısı ve alıcı doğrulama", () => {
  it("production'da iyzico yoksa (demo izni yok) ödeme açılmaz; kredi de iyzico olmadan kullanılamaz", async () => {
    h.configured = false;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_BILLING_DEMO", "");
    expect((await startPlanCheckout(form())).error).toMatch(/yapılandırılmamış/);
    expect(h.createInvoice).not.toHaveBeenCalled();
    expect(h.fulfillDemo).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    expect((await startPlanCheckout(form({ use_credit: "1" }))).error).toMatch(/ödeme altyapısı bağlıyken/);
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("alıcı bilgisi eksikse ayarlara yönlendiren mesaj; fatura oluşmaz", async () => {
    h.buyer.mockImplementation(() => {
      throw new ActionUserError("Vergi numarası eksik.");
    });
    const r = await startPlanCheckout(form());
    expect(r.error).toMatch(/Vergi numarası eksik\..*Ayarlar bölümünden/);
    expect(h.createInvoice).not.toHaveBeenCalled();
  });

  it("fatura taslağı oluşmazsa (ör. kredi yetersiz) hata aynen döner; iyzico çağrılmaz", async () => {
    h.createInvoice.mockRejectedValue(new ActionUserError("Hesap kredisi bakiyesi yetersiz."));
    expect((await startPlanCheckout(form({ use_credit: "1" }))).error).toBe("Hesap kredisi bakiyesi yetersiz.");
    expect(h.initCheckout).not.toHaveBeenCalled();
    expect(h.markFailed).not.toHaveBeenCalled(); // taslak hiç oluşmadı
  });
});

describe("startPlanCheckout — demo / kredi / iyzico yolları", () => {
  it("demo (iyzico yok, geliştirme): fulfill 'demo' kaynağıyla çağrılır; hata olursa fatura failed", async () => {
    h.configured = false;
    const ok = await startPlanCheckout(form());
    expect(ok.demo).toBe(true);
    expect(h.fulfillDemo).toHaveBeenCalledWith(expect.objectContaining({ source: "demo", plan: "office", expectedCurrency: "TRY" }));
    expect(h.initCheckout).not.toHaveBeenCalled();
    h.fulfillDemo.mockRejectedValue(new Error("Tutar uyuşmuyor."));
    expect((await startPlanCheckout(form())).error).toMatch(/^Demo tahsilat tamamlanamadı: /); // iç hata metni sızmaz
    expect(h.markFailed).toHaveBeenCalledTimes(1);
  });

  it("TAM kredi: iyzico ÇAĞRILMAZ, kredi fulfill; hata olursa fatura failed", async () => {
    h.createInvoice.mockResolvedValue({ invoiceId: "inv-1", credit: { fullCredit: true, creditTry: 2988, cashTry: 0 } });
    const r = await startPlanCheckout(form({ use_credit: "1" }));
    expect(r.checkoutUrl).toBe("https://app.test/app/abonelik?paid=1&plan=office");
    expect(h.fulfillCredit).toHaveBeenCalledTimes(1);
    expect(h.initCheckout).not.toHaveBeenCalled();
    h.fulfillCredit.mockRejectedValue(new Error("Kredi düşülemedi."));
    expect((await startPlanCheckout(form({ use_credit: "1" }))).error).toMatch(/^Kredi ile ödeme tamamlanamadı: /);
    expect(h.markFailed).toHaveBeenCalledTimes(1);
  });

  it("KISMİ kredi: iyzico yalnız kalan nakit tutarı tahsil eder", async () => {
    h.createInvoice.mockResolvedValue({ invoiceId: "inv-1", credit: { fullCredit: false, creditTry: 400, cashTry: 2588 } });
    await startPlanCheckout(form({ use_credit: "1" }));
    expect(h.initCheckout).toHaveBeenCalledWith(expect.objectContaining({ price: 2588, paidPrice: 2588 }));
  });

  it("iyzico oturumu başarısız / istisna: fatura failed, kullanıcıya hata; başarıda initialized", async () => {
    h.initCheckout.mockResolvedValue({ status: "failure", errorMessage: "Kart reddedildi." });
    expect((await startPlanCheckout(form())).error).toBe("Kart reddedildi.");
    expect(h.markFailed).toHaveBeenCalledTimes(1);
    h.initCheckout.mockResolvedValue({ status: "success", paymentPageUrl: "" });
    expect((await startPlanCheckout(form())).error).toMatch(/^Ödeme oturumu açılamadı: /);
    h.initCheckout.mockRejectedValue(new Error("ağ hatası"));
    expect((await startPlanCheckout(form())).error).toMatch(/^Ödeme sayfası açılamadı: /); // ham "ağ hatası" gösterilmez
    expect(h.markFailed).toHaveBeenCalledTimes(3);
    expect(h.markInitialized).not.toHaveBeenCalled();
    h.initCheckout.mockResolvedValue({ status: "success", paymentPageUrl: "https://iyzico.test/pay" });
    expect((await startPlanCheckout(form())).checkoutUrl).toBe("https://iyzico.test/pay");
    expect(h.markInitialized).toHaveBeenCalledTimes(1);
  });

  it("kayıtlı kart anahtarı yalnız owner/gm + talep varsa gönderilir", async () => {
    await startPlanCheckout(form());
    expect(h.initCheckout.mock.calls[0]![0].cardUserKey).toBeNull();
    expect(h.cardKey).not.toHaveBeenCalled();
    await startPlanCheckout(form({ use_saved_card: "1" }));
    expect(h.initCheckout.mock.calls[1]![0].cardUserKey).toBe("card-user-key");
  });
});

describe("startCreditPackPurchase (EF kontör) — hata yolları", () => {
  const pform = (over: Record<string, string> = {}) => {
    const f = new FormData();
    const base: Record<string, string> = { pack_id: "p100", ...over };
    for (const [k, v] of Object.entries(base)) f.set(k, v);
    return f;
  };

  it("yalnız owner/gm; destek (impersonate) oturumunda yok; geçersiz paket kimliği; kupon yok", async () => {
    h.gate = { ok: true, userId: "u1", tenantId: "12345678-x", role: "advisor", impersonating: false };
    expect((await startCreditPackPurchase(pform())).error).toMatch(/ofis sahibi veya genel müdür/);
    h.gate = { ok: true, userId: "u1", tenantId: "12345678-x", role: "owner", impersonating: true };
    expect((await startCreditPackPurchase(pform())).error).toMatch(/Destek oturumunda/);
    h.gate = { ok: true, userId: "u1", tenantId: "12345678-x", role: "owner", impersonating: false };
    expect((await startCreditPackPurchase(pform({ pack_id: "../x" }))).error).toBe("Geçersiz paket.");
    expect((await startCreditPackPurchase(pform({ coupon: "YAZ10" }))).error).toMatch(/Kupon kontör paketlerinde geçerli değil/);
    expect(h.packInvoice).not.toHaveBeenCalled();
  });

  it("hız sınırı; EF satışa kapalı; cüzdan hazır değil; iyzico yok: PARA ALINMAZ (fatura yok)", async () => {
    h.rateAllowed = false;
    expect((await startCreditPackPurchase(pform())).error).toMatch(/Çok fazla deneme/);
    h.rateAllowed = true;
    h.efPurchasable = false;
    expect((await startCreditPackPurchase(pform())).error).toBe("EF satışı kapalı.");
    h.efPurchasable = true;
    h.efReady = false;
    expect((await startCreditPackPurchase(pform())).error).toMatch(/henüz etkin değil/);
    h.efReady = true;
    // Süreli parti şeması (20261010000300) yokken paket SATILMAZ: kontör süresiz kalırdı.
    h.efLotsReady = false;
    expect((await startCreditPackPurchase(pform())).error).toMatch(/Süreli kontör paketleri hazırlanıyor/);
    h.efLotsReady = true;
    h.configured = false;
    expect((await startCreditPackPurchase(pform())).error).toMatch(/yapılandırılmamış/);
    expect(h.packInvoice).not.toHaveBeenCalled();
    expect(h.initCheckout).not.toHaveBeenCalled();
  });

  it("satıştan kalkmış paket ve değişen tutar (confirm_try) reddedilir; yeni tutar döner", async () => {
    h.pack = null;
    expect((await startCreditPackPurchase(pform())).error).toMatch(/artık satışta değil/);
    h.pack = { id: "p100", name: "100 kontör", units: 100, priceNetTry: 990 };
    const r = await startCreditPackPurchase(pform({ confirm_try: "999" }));
    expect(r.error).toMatch(/Tutar güncellendi/);
    expect(r.quotedTotalTry).toBe(1188);
    expect(h.packInvoice).not.toHaveBeenCalled();
  });

  it("fatura hatası aynen döner; iyzico başarısızsa fatura failed; tam kredide iyzico çağrılmaz", async () => {
    h.packInvoice.mockRejectedValue(new ActionUserError("Hesap kredisi bakiyesi yetersiz."));
    expect((await startCreditPackPurchase(pform({ use_credit: "1" }))).error).toBe("Hesap kredisi bakiyesi yetersiz.");
    h.packInvoice.mockResolvedValue({ invoiceId: "inv-pack", totalTry: 1188, credit: null });
    h.initCheckout.mockResolvedValue({ status: "failure", errorMessage: "Banka hatası." });
    expect((await startCreditPackPurchase(pform())).error).toBe("Banka hatası.");
    expect(h.markFailed).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: "inv-pack" }));
    h.markFailed.mockClear();
    h.initCheckout.mockClear();
    h.packInvoice.mockResolvedValue({ invoiceId: "inv-pack", totalTry: 1188, credit: { fullCredit: true, creditTry: 1188, cashTry: 0 } });
    const full = await startCreditPackPurchase(pform({ use_credit: "1" }));
    expect(full.checkoutUrl).toBe("https://app.test/app/abonelik?sekme=kontor&paid=1");
    expect(h.fulfillCredit).toHaveBeenCalledTimes(1);
    expect(h.initCheckout).not.toHaveBeenCalled();
    h.fulfillCredit.mockRejectedValue(new Error("Kredi düşülemedi."));
    expect((await startCreditPackPurchase(pform({ use_credit: "1" }))).error).toMatch(/^Kredi ile ödeme tamamlanamadı: /);
    expect(h.markFailed).toHaveBeenCalledTimes(1);
  });

  it("başarı: iyzico oturumu açılır, fatura initialized, quotedTotalTry döner", async () => {
    const r = await startCreditPackPurchase(pform({ confirm_try: "1188" }));
    expect(r).toEqual({ checkoutUrl: "https://iyzico.test/pay", quotedTotalTry: 1188 });
    expect(h.markInitialized).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: "inv-pack" }));
  });
});
