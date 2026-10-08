"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { PLANS, planAmountOf, type BillingCycle, type PlanId } from "@/lib/billing/plans";
import { getPlanDefinition, getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { evaluateSeatChange } from "@/lib/billing/seat-purchase-core";
import { evaluatePlanChange } from "@/lib/billing/plan-change-core";
import { isPlanChangeEnabled, loadPlanChangeState } from "@/lib/billing/plan-change";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { createSeatInvoice, getSeatSupport, loadSeatState } from "@/lib/billing/seat-purchase";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { quoteCoupon, redeemCoupon } from "@/lib/billing/coupon-server";
import {
  IYZICO_CURRENCY,
  initializeCheckoutForm,
  isIyzicoConfigured,
} from "@/lib/billing/iyzico";
import {
  assertBillingPlanPreflight,
  createCheckoutInvoice,
  fulfillInvoiceWithWalletCredit,
  fulfillSuccessfulPayment,
  invoiceAmountsTry,
  markCheckoutInvoiceFailed,
  markCheckoutInvoiceInitialized,
} from "@/lib/billing/fulfillment";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { validateCheckoutBuyer, type ValidatedCheckoutBuyer } from "@/lib/billing/buyer";
import { getBaseUrl } from "@/lib/base-url";
import { getTenantCardUserKey } from "@/lib/billing/card-store";
import { createCreditPackInvoice } from "@/lib/billing/credit-pack-purchase";
import { creditPackBasketName, findPurchasablePack, quoteCreditPack } from "@/lib/billing/credit-pack-purchase-core";
import { getEfCatalog, getEfCreditReady } from "@/lib/ef-credits/credit-reader";
import { EF_PURCHASE_CLOSED_MESSAGE, getEfPublicState } from "@/lib/ef-credits/public-state";
import { getTryMaxShare } from "@/lib/try-credits/settings";
import type { AppliedWalletCredit } from "@/lib/try-credits/checkout";
import { billingDemoAllowed } from "@/lib/feature-flags/registry";
import { ActionUserError, actionErrorMessage } from "@/lib/action-errors";

export type CheckoutResult = {
  error?: string;
  checkoutUrl?: string;
  demo?: boolean;
};

const PLAN_IDS = new Set(PLANS.map((p) => p.id));

/**
 * iyzico `cardUserKey`: kayıtlı kartlar ödeme sayfasında YALNIZ owner/gm için ve YALNIZ kullanıcı bunu istediyse
 * (kart kaydetme rızası veya "kayıtlı kartla öde") listelenir. Diğer roller/istekler için null (RPC bile çağrılmaz).
 */
async function cardUserKeyForCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: string | undefined,
  wanted: boolean,
): Promise<string | null> {
  if (!wanted || (role !== "owner" && role !== "gm")) return null;
  return getTenantCardUserKey(supabase);
}

function appUrl() {
  return getBaseUrl();
}

export async function startPlanCheckout(formData: FormData): Promise<CheckoutResult> {
  const gate = await requirePermission("billing", "edit", { allowSuspended: true });
  if (!gate.ok) return { error: gate.error };

  const plan = String(formData.get("plan") ?? "").trim() as PlanId;
  const cycle = (String(formData.get("cycle") ?? "monthly").trim() || "monthly") as BillingCycle;
  if (!PLAN_IDS.has(plan)) return { error: "Geçersiz paket." };
  if (cycle !== "monthly" && cycle !== "yearly") return { error: "Geçersiz dönem." };
  // "Hesap kredimi kullan" (TL kredi cüzdanı): tutar istemciden ALINMAZ; sunucu bakiye ve pay sınırıyla hesaplar.
  const useCredit = String(formData.get("use_credit") ?? "") === "1";
  if (useCredit && gate.role !== "owner" && gate.role !== "gm") {
    return { error: "Hesap kredisini yalnızca ofis sahibi veya genel müdür kullanabilir." };
  }

  // Kart saklama AÇIK RIZASI: yalnız form alanı tam olarak "1" ise (onay kutusu varsayılan KAPALI). Kart verisi
  // bu action'a hiç gelmez; kart iyzico'nun barındırılan sayfasında girilir.
  const saveCardConsent = String(formData.get("save_card") ?? "") === "1";
  const useSavedCard = String(formData.get("use_saved_card") ?? "") === "1";
  if (saveCardConsent && (gate.role !== "owner" && gate.role !== "gm")) {
    return { error: "Kartı yalnızca ofis sahibi veya genel müdür kaydedebilir." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const [{ data: tenant }, { data: profile }, { data: sub }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, name, plan, tax_number, phone, address_line, city")
      .eq("id", gate.tenantId)
      .maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
    supabase.from("subscriptions").select("id").eq("tenant_id", gate.tenantId).maybeSingle(),
  ]);

  if (!tenant) return { error: "Ofis bulunamadı." };

  // Duraklatma / oransal paket değişikliği (varsayılan KAPALI bayraklar; şema yoksa durum null ve davranış DEĞİŞMEZ).
  const changeState = await loadPlanChangeState(supabase, gate.tenantId);
  if (changeState?.pause.paused) {
    return { error: "Aboneliğiniz duraklatıldı; ödeme yapmak için önce devam ettirin." };
  }
  if (changeState && changeState.status === "active" && changeState.planId !== plan && isIyzicoConfigured() && (await isPlanChangeEnabled()) && (await getPlanSupport()).upgradeReady) {
    // Aktif ücretli abonelikte paket değişimi tam fiyatla dönem sıfırlamaz: yükseltme oransal, düşürme dönem sonunda.
    const change = evaluatePlanChange({
      plans: await getPlanDefinitions(),
      fromPlanId: changeState.planId,
      toPlanId: plan,
      cycle: changeState.cycle,
      lockedMonthlyTry: changeState.lockedMonthlyTry,
      periodStartMs: changeState.periodStartMs,
      periodEndMs: changeState.periodEndMs,
      nowMs: now(),
    });
    if (change.status === "upgrade") {
      return { error: "Aktif aboneliğinizde üst pakete geçiş kalan süre oranında faturalanır: Paket ve ödeme ekranında 'Oransal yükselt' seçeneğini kullanın." };
    }
    if (change.status === "downgrade") {
      return { error: "Daha ucuz pakete geçiş dönem sonunda uygulanır: Paket ve ödeme ekranında 'Dönem sonunda geç' seçeneğini kullanın. İade yapılmaz." };
    }
  }

  try {
    await assertBillingPlanPreflight(gate.tenantId, plan);
  } catch (error) {
    return { error: actionErrorMessage(error, "Paket kapasitesi doğrulanamadı.") };
  }

  const planDef = await getPlanDefinition(plan);
  if (planDef.hidden) {
    return { error: "Bu paket çevrimiçi satın alınamıyor." };
  }
  const listAmountTry = planAmountOf(planDef, cycle);
  // Kupon (isteğe bağlı `coupon` alanı): önce tüketmeden doğrulanır, fatura oluşunca atomik tüketilir.
  const couponCode = String(formData.get("coupon") ?? "").trim();
  let couponDiscountTry = 0;
  let couponNormalized = "";
  if (couponCode) {
    const quote = await quoteCoupon(couponCode, plan, listAmountTry);
    if (!quote.ok) return { error: quote.error };
    couponDiscountTry = quote.discountTry;
    couponNormalized = quote.code;
  }
  const amountTry = Math.round((listAmountTry - couponDiscountTry) * 100) / 100;
  const invoiceAmounts = invoiceAmountsTry(amountTry);
  const conversationId = `es-${gate.tenantId.slice(0, 8)}-${randomBytes(12).toString("hex")}`;
  const configured = isIyzicoConfigured();
  const demoAllowed = billingDemoAllowed(); // tek tanım: lib/feature-flags/registry.ts (ALLOW_BILLING_DEMO)
  let checkoutBuyer: ValidatedCheckoutBuyer | null = null;

  if (!configured && !demoAllowed) {
    return { error: "Ödeme altyapısı yapılandırılmamış. Lütfen yönetici ile iletişime geçin." };
  }
  if (useCredit && !configured) {
    return { error: "Hesap kredisi, ödeme altyapısı bağlıyken kullanılabilir." };
  }

  if (configured) {
    try {
      checkoutBuyer = validateCheckoutBuyer({
        id: user.id,
        fullName: profile?.full_name,
        email: user.email,
        phone: profile?.phone || tenant.phone,
        identityNumber: tenant.tax_number,
        address: tenant.address_line,
        city: tenant.city,
        ip: await clientIp(),
      });
    } catch (error) {
      return {
        error: error instanceof ActionUserError
          ? `${error.message} Ofis ve fatura bilgilerini Ayarlar bölümünden tamamlayın.`
          : actionErrorMessage(error, "Ödeme sahibi bilgileri doğrulanamadı."),
      };
    }
  }

  let invoiceId: string;
  let credit: AppliedWalletCredit | null = null;
  try {
    const created = await createCheckoutInvoice({
      tenantId: gate.tenantId,
      subscriptionId: sub?.id ?? null,
      plan,
      cycle,
      conversationId,
      amountTry,
      saveCard: saveCardConsent && configured ? { consentUserId: user.id } : null,
      walletCredit: useCredit ? { userId: user.id, maxShare: await getTryMaxShare() } : null,
    });
    invoiceId = created.invoiceId;
    credit = created.credit;
  } catch (error) {
    return { error: actionErrorMessage(error, "Fatura taslağı oluşturulamadı.") };
  }

  if (couponNormalized) {
    const redeemed = await redeemCoupon({
      code: couponNormalized,
      tenantId: gate.tenantId,
      invoiceId,
      plan,
      baseAmountTry: listAmountTry,
    });
    if (!redeemed.ok || Math.abs(redeemed.discountTry - couponDiscountTry) > 0.01) {
      await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
      return { error: redeemed.ok ? "Kupon tutarı değişti; lütfen yeniden deneyin." : redeemed.error };
    }
  }

  // Sandbox anahtarı yoksa: demo ödeme akışı — YALNIZCA geliştirmede/açıkça izin verildiğinde.
  // Production'da iyzico yoksa demo tahsilatla ücretsiz abonelik verilmesi engellenir.
  if (!configured) {
    try {
      await fulfillSuccessfulPayment({
        tenantId: gate.tenantId,
        plan,
        cycle,
        conversationId,
        paymentId: `demo-${conversationId}`,
        expectedAmountTry: invoiceAmounts.totalTry,
        expectedCurrency: IYZICO_CURRENCY,
        source: "demo",
      });
    } catch (error) {
      await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
      return { error: actionErrorMessage(error, "Demo tahsilat tamamlanamadı.") };
    }
    revalidatePath("/app/abonelik");
    revalidatePath("/app/ayarlar");
    revalidatePath("/admin/billing");
    return {
      checkoutUrl: `${appUrl()}/app/abonelik?paid=1&demo=1&plan=${plan}`,
      demo: true,
    };
  }

  // TAM kredi (yalnız pay=1 yapılandırmasında): iyzico ÇAĞRILMAZ; kredi + fulfill tek SQL işleminde tamamlanır.
  if (credit?.fullCredit) {
    try {
      await fulfillInvoiceWithWalletCredit({ tenantId: gate.tenantId, plan, cycle, conversationId });
    } catch (error) {
      await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
      return { error: actionErrorMessage(error, "Kredi ile ödeme tamamlanamadı.") };
    }
    revalidatePath("/app/abonelik");
    revalidatePath("/app/ayarlar");
    revalidatePath("/admin/billing");
    return { checkoutUrl: `${appUrl()}/app/abonelik?paid=1&plan=${plan}` };
  }

  try {
    // Kısmi kredi: iyzico YALNIZ kalan nakit tutarı tahsil eder (fatura toplamı/KDV değişmez).
    const chargeTry = credit ? credit.cashTry : invoiceAmounts.totalTry;
    const init = await initializeCheckoutForm({
      conversationId,
      price: chargeTry,
      paidPrice: chargeTry,
      basketId: conversationId,
      callbackUrl: `${appUrl()}/api/iyzico/callback`,
      buyer: checkoutBuyer!.buyer,
      billingAddress: checkoutBuyer!.billingAddress,
      basketItemName: `EmlakSoft ${plan} (${cycle === "yearly" ? "yıllık" : "aylık"})`,
      // cardUserKey YALNIZ owner/gm + (kayıt rızası VEYA "kayıtlı kartla öde") ile gönderilir; aksi halde başka roller
      // (ör. muhasebe) ofis sahibinin kartını ödeme sayfasında göremez/kullanamaz.
      cardUserKey: await cardUserKeyForCheckout(supabase, gate.role, saveCardConsent || useSavedCard),
    });
    if (useSavedCard) {
      await logActivity({
        tenantId: gate.tenantId,
        actorId: gate.userId,
        action: "billing.card.pay_started",
        entityType: "invoice",
        entityId: invoiceId,
        newValue: { plan, cycle, amountTry },
      });
    }

    if (init.status !== "success" || !init.paymentPageUrl) {
      await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
      return { error: init.errorMessage || actionErrorMessage(null, "Ödeme oturumu açılamadı.") };
    }

    await markCheckoutInvoiceInitialized({ invoiceId, tenantId: gate.tenantId });
    return { checkoutUrl: init.paymentPageUrl };
  } catch (e) {
    await markCheckoutInvoiceFailed({ invoiceId, tenantId: gate.tenantId });
    console.error("startPlanCheckout", e);
    return { error: actionErrorMessage(e, "Ödeme sayfası açılamadı") };
  }
}

export type SeatPurchaseResult = CheckoutResult & { quotedChargeTry?: number };

/**
 * Ek kullanıcı (koltuk) ARTIRMA satın alma. YALNIZ owner/gm. Tutar istemciden ALINMAZ: hedef toplam koltuk sayısı
 * gelir, fiyat/oransal tutar sunucuda `evaluateSeatChange` (quoteSeats + prorateSeatChange) ile yeniden hesaplanır.
 * `confirm_try` yalnız "ekranda gördüğünüz tutar değişti mi" kontrolüdür, hesaba girmez.
 * Koltuk satışı hazır değilse (extra_seats + effective_seat_limit + seat_purchase_ready()) para tahsil eden
 * hiçbir adım atılmaz. Demo ödeme YOKTUR: iyzico yoksa reddedilir.
 */
export async function startSeatPurchase(formData: FormData): Promise<SeatPurchaseResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda koltuk satın alınamaz." };
  if (gate.role !== "owner" && gate.role !== "gm") {
    return { error: "Kullanıcı sayısını yalnızca ofis sahibi veya genel müdür değiştirebilir." };
  }

  const target = Number(String(formData.get("target_seats") ?? "").trim());
  if (!Number.isInteger(target) || target < 1 || target > 5000) return { error: "Geçersiz kullanıcı sayısı." };
  const confirmRaw = String(formData.get("confirm_try") ?? "").trim();
  const confirmTry = confirmRaw === "" ? null : Number(confirmRaw);
  const useCredit = String(formData.get("use_credit") ?? "") === "1";

  const { allowed } = await checkRateLimit(`seatbuy:${gate.userId}`, { limit: 8, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin." };

  const support = await getSeatSupport();
  if (!support.purchaseReady) {
    return { error: "Ek kullanıcı satın alma henüz etkin değil: yönetici hazırlığı tamamlanıyor." };
  }
  if (!isIyzicoConfigured()) {
    return { error: "Ödeme altyapısı yapılandırılmamış. Lütfen yönetici ile iletişime geçin." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const state = await loadSeatState(supabase, gate.tenantId, support);
  if (!state) return { error: actionErrorMessage(null, "Abonelik bilgisi okunamadı.") };
  if (state.status !== "active") {
    return { error: "Koltuk eklemek için önce ücretli bir paket aktif olmalı (deneme veya gecikmiş abonelikte kapalı)." };
  }
  if ((await loadPlanChangeState(supabase, gate.tenantId))?.pause.paused) {
    return { error: "Aboneliğiniz duraklatıldı; koltuk eklemek için önce devam ettirin." };
  }

  const [plans, { count: used }, { data: tenant }, { data: profile }] = await Promise.all([
    getPlanDefinitions(),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", gate.tenantId)
      .eq("is_active", true),
    supabase.from("tenants").select("id, name, tax_number, phone, address_line, city").eq("id", gate.tenantId).maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
  ]);
  const def = plans.find((p) => p.id === state.planId);
  if (!def) return { error: "Paket bulunamadı." };
  if (!tenant) return { error: "Ofis bulunamadı." };

  const evalResult = evaluateSeatChange({
    plans,
    planId: state.planId,
    cycle: state.cycle,
    usedSeats: used ?? 0,
    currentTotalSeats: def.limits.seats + state.extraSeats,
    targetTotalSeats: target,
    locks: { baseMonthlyTry: state.lockedBaseMonthlyTry, tiers: state.lockedTiers },
    periodStartMs: state.periodStartMs,
    periodEndMs: state.periodEndMs,
    nowMs: now(),
  });
  if (evalResult.status === "decrease") {
    return { error: "Azaltma dönem sonunda uygulanır ve bu ekrandan henüz talep edilemez; iade yapılmaz." };
  }
  if (evalResult.status !== "increase") return { error: evalResult.message };
  const chargeNet = evalResult.immediateChargeTry;
  if (!(chargeNet > 0)) {
    return { error: "Dönem bitmek üzere olduğundan şimdi ek tutar çıkmıyor; yenileme sonrası tekrar deneyin." };
  }
  if (confirmTry !== null && (!Number.isFinite(confirmTry) || Math.abs(confirmTry - chargeNet) > 0.01)) {
    return { error: "Tutar güncellendi; lütfen yeni tutarı inceleyip yeniden onaylayın.", quotedChargeTry: chargeNet };
  }

  let checkoutBuyer: ValidatedCheckoutBuyer;
  try {
    checkoutBuyer = validateCheckoutBuyer({
      id: user.id,
      fullName: profile?.full_name,
      email: user.email,
      phone: profile?.phone || tenant.phone,
      identityNumber: tenant.tax_number,
      address: tenant.address_line,
      city: tenant.city,
      ip: await clientIp(),
    });
  } catch (error) {
    return {
      error: error instanceof ActionUserError
        ? `${error.message} Ofis ve fatura bilgilerini Ayarlar bölümünden tamamlayın.`
        : actionErrorMessage(error, "Ödeme sahibi bilgileri doğrulanamadı."),
    };
  }

  const conversationId = `es-${gate.tenantId.slice(0, 8)}-${randomBytes(12).toString("hex")}`;
  let invoice: { invoiceId: string; totalTry: number; credit: AppliedWalletCredit | null };
  try {
    invoice = await createSeatInvoice({
      walletCredit: useCredit ? { userId: user.id, maxShare: await getTryMaxShare() } : null,
      tenantId: gate.tenantId,
      subscriptionId: state.subscriptionId,
      plan: state.planId as PlanId,
      cycle: state.cycle,
      conversationId,
      chargeNetTry: chargeNet,
      fromExtraSeats: state.extraSeats,
      toExtraSeats: evalResult.toQuote.extraSeats,
      targetTotalSeats: evalResult.toQuote.totalSeats,
      quotedPeriodTry: evalResult.toQuote.totalForCycleTry,
    });
  } catch (error) {
    return { error: actionErrorMessage(error, "Fatura taslağı oluşturulamadı.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "billing.seats.checkout_started",
    entityType: "invoice",
    entityId: invoice.invoiceId,
    oldValue: { totalSeats: evalResult.fromQuote.totalSeats, extraSeats: state.extraSeats },
    newValue: {
      totalSeats: evalResult.toQuote.totalSeats,
      extraSeats: evalResult.toQuote.extraSeats,
      chargeNetTry: chargeNet,
      invoiceTotalTry: invoice.totalTry,
      walletCreditTry: invoice.credit?.creditTry ?? 0,
    },
  });

  if (invoice.credit?.fullCredit) {
    try {
      await fulfillInvoiceWithWalletCredit({
        tenantId: gate.tenantId,
        plan: state.planId as PlanId,
        cycle: state.cycle,
        conversationId,
      });
    } catch (error) {
      await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
      return { error: actionErrorMessage(error, "Kredi ile ödeme tamamlanamadı.") };
    }
    revalidatePath("/app/abonelik");
    return { checkoutUrl: `${appUrl()}/app/abonelik?paid=1`, quotedChargeTry: chargeNet };
  }

  try {
    const chargeTry = invoice.credit ? invoice.credit.cashTry : invoice.totalTry;
    const init = await initializeCheckoutForm({
      conversationId,
      price: chargeTry,
      paidPrice: chargeTry,
      basketId: conversationId,
      callbackUrl: `${appUrl()}/api/iyzico/callback`,
      buyer: checkoutBuyer.buyer,
      billingAddress: checkoutBuyer.billingAddress,
      basketItemName: `EmlakSoft ek kullanıcı (${evalResult.toQuote.extraSeats - state.extraSeats} adet)`,
      cardUserKey: await cardUserKeyForCheckout(supabase, gate.role, String(formData.get("use_saved_card") ?? "") === "1"),
    });
    if (init.status !== "success" || !init.paymentPageUrl) {
      await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
      return { error: init.errorMessage || actionErrorMessage(null, "Ödeme oturumu açılamadı.") };
    }
    await markCheckoutInvoiceInitialized({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
    revalidatePath("/app/abonelik");
    return { checkoutUrl: init.paymentPageUrl, quotedChargeTry: chargeNet };
  } catch (e) {
    await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
    console.error("startSeatPurchase", e);
    return { error: actionErrorMessage(e, "Ödeme sayfası açılamadı") };
  }
}

export type CreditPackPurchaseResult = CheckoutResult & { quotedTotalTry?: number };

/**
 * Kontör (EmlakFiyati) paketi satın alma. YALNIZ owner/gm. Paket kimliği gelir; kontör ve fiyat SUNUCUDA katalogdan
 * (platform_settings) yeniden hesaplanır, istemciden tutar/kontör ALINMAZ. `confirm_try` yalnız "ekrandaki tutar değişti mi"
 * kontrolüdür. Cüzdan hazır değilse (`ef_credit_ready()`) para tahsil eden hiçbir adım atılmaz. Demo ödeme YOKTUR.
 * Kupon kontör paketlerinde KAPALIDIR (kupon mantığı plan kimliğine bağlıdır).
 */
export async function startCreditPackPurchase(formData: FormData): Promise<CreditPackPurchaseResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda kontör satın alınamaz." };
  if (gate.role !== "owner" && gate.role !== "gm") {
    return { error: "Kontör paketini yalnızca ofis sahibi veya genel müdür satın alabilir." };
  }

  const packId = String(formData.get("pack_id") ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(packId)) return { error: "Geçersiz paket." };
  if (String(formData.get("coupon") ?? "").trim()) return { error: "Kupon kontör paketlerinde geçerli değil." };
  const confirmRaw = String(formData.get("confirm_try") ?? "").trim();
  const confirmTry = confirmRaw === "" ? null : Number(confirmRaw);
  const useCredit = String(formData.get("use_credit") ?? "") === "1";

  const { allowed } = await checkRateLimit(`efpack:${gate.userId}`, { limit: 8, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin." };

  // Tek durum kaynağı: EmlakFiyati değerleme canlı değilse (anahtar/bayrak/taze yoklama/cüzdan) PARA ALINMAZ.
  if (!(await getEfPublicState()).purchasable) return { error: EF_PURCHASE_CLOSED_MESSAGE };
  if (!(await getEfCreditReady())) {
    return { error: "Kontör satın alma henüz etkin değil: yönetici hazırlığı tamamlanıyor." };
  }
  if (!isIyzicoConfigured()) {
    return { error: "Ödeme altyapısı yapılandırılmamış. Lütfen yönetici ile iletişime geçin." };
  }

  const catalog = await getEfCatalog();
  const pack = findPurchasablePack(catalog.packs, packId);
  if (!pack) return { error: "Bu paket artık satışta değil. Sayfayı yenileyip güncel paketleri görün." };
  const quote = quoteCreditPack(pack);
  if (confirmTry !== null && (!Number.isFinite(confirmTry) || Math.abs(confirmTry - quote.totalTry) > 0.01)) {
    return { error: "Tutar güncellendi; lütfen yeni tutarı inceleyip yeniden onaylayın.", quotedTotalTry: quote.totalTry };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." };
  const [{ data: tenant }, { data: profile }] = await Promise.all([
    supabase.from("tenants").select("id, name, tax_number, phone, address_line, city").eq("id", gate.tenantId).maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
  ]);
  if (!tenant) return { error: "Ofis bulunamadı." };

  let checkoutBuyer: ValidatedCheckoutBuyer;
  try {
    checkoutBuyer = validateCheckoutBuyer({
      id: user.id,
      fullName: profile?.full_name,
      email: user.email,
      phone: profile?.phone || tenant.phone,
      identityNumber: tenant.tax_number,
      address: tenant.address_line,
      city: tenant.city,
      ip: await clientIp(),
    });
  } catch (error) {
    return {
      error: error instanceof ActionUserError
        ? `${error.message} Ofis ve fatura bilgilerini Ayarlar bölümünden tamamlayın.`
        : actionErrorMessage(error, "Ödeme sahibi bilgileri doğrulanamadı."),
    };
  }

  const conversationId = `es-${gate.tenantId.slice(0, 8)}-${randomBytes(12).toString("hex")}`;
  let invoice: { invoiceId: string; totalTry: number; credit?: AppliedWalletCredit | null };
  try {
    invoice = await createCreditPackInvoice({
      tenantId: gate.tenantId,
      pack,
      conversationId,
      walletCredit: useCredit ? { userId: user.id, maxShare: await getTryMaxShare() } : null,
    });
  } catch (error) {
    return { error: actionErrorMessage(error, "Fatura taslağı oluşturulamadı.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "billing.credits.checkout_started",
    entityType: "invoice",
    entityId: invoice.invoiceId,
    newValue: {
      packId: pack.id,
      units: pack.units,
      priceNetTry: pack.priceNetTry,
      invoiceTotalTry: invoice.totalTry,
      walletCreditTry: invoice.credit?.creditTry ?? 0,
    },
  });

  if (invoice.credit?.fullCredit) {
    try {
      // Paket faturasında plan/döngü meta'sı yok: callback ile aynı varsayılanlar (SQL de aynı varsayılanı kullanır).
      await fulfillInvoiceWithWalletCredit({
        tenantId: gate.tenantId,
        plan: "office",
        cycle: "monthly",
        conversationId,
      });
    } catch (error) {
      await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
      return { error: actionErrorMessage(error, "Kredi ile ödeme tamamlanamadı.") };
    }
    revalidatePath("/app/abonelik");
    return { checkoutUrl: `${appUrl()}/app/abonelik?sekme=kontor&paid=1`, quotedTotalTry: invoice.totalTry };
  }

  try {
    const chargeTry = invoice.credit ? invoice.credit.cashTry : invoice.totalTry;
    const init = await initializeCheckoutForm({
      conversationId,
      price: chargeTry,
      paidPrice: chargeTry,
      basketId: conversationId,
      callbackUrl: `${appUrl()}/api/iyzico/callback`,
      buyer: checkoutBuyer.buyer,
      billingAddress: checkoutBuyer.billingAddress,
      basketItemName: creditPackBasketName(pack),
    });
    if (init.status !== "success" || !init.paymentPageUrl) {
      await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
      return { error: init.errorMessage || actionErrorMessage(null, "Ödeme oturumu açılamadı.") };
    }
    await markCheckoutInvoiceInitialized({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
    revalidatePath("/app/abonelik");
    return { checkoutUrl: init.paymentPageUrl, quotedTotalTry: invoice.totalTry };
  } catch (e) {
    await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
    console.error("startCreditPackPurchase", e);
    return { error: actionErrorMessage(e, "Ödeme sayfası açılamadı") };
  }
}
