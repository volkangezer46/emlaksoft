"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/require-permission";
import { isPlanId, type PlanId } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { evaluatePlanChange } from "@/lib/billing/plan-change-core";
import { isPlanChangeEnabled, loadPaidCapNetTry, loadPlanChangeState } from "@/lib/billing/plan-change";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { getExtraSeats } from "@/lib/billing/seat-purchase";
import { logActivity } from "@/lib/activity";
import { now } from "@/lib/clock";
import { initializeCheckoutForm, isIyzicoConfigured } from "@/lib/billing/iyzico";
import {
  assertBillingPlanPreflight,
  createCheckoutInvoice,
  fulfillInvoiceWithWalletCredit,
  markCheckoutInvoiceFailed,
  markCheckoutInvoiceInitialized,
} from "@/lib/billing/fulfillment";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { validateCheckoutBuyer, type ValidatedCheckoutBuyer } from "@/lib/billing/buyer";
import { getBaseUrl } from "@/lib/base-url";
import { getTenantCardUserKey } from "@/lib/billing/card-store";
import { getTryMaxShare } from "@/lib/try-credits/settings";
import type { AppliedWalletCredit } from "@/lib/try-credits/checkout";
import { ActionUserError, actionErrorMessage } from "@/lib/action-errors";

/**
 * ORANSAL PAKET YÜKSELTME + PLANLI DÜŞÜRME (varsayılan KAPALI: `billing.plan_change_proration_enabled`).
 *
 *  - Yükseltme: aktif ücretli abonelikte üst pakete geçişte kalan süre oranında fark faturası (iyzico checkout; TL hesap kredisi
 *    koltuk satışındaki desenle). Tutar istemciden ALINMAZ; `confirm_try` yalnız "ekrandaki tutar değişti mi" kontrolüdür.
 *    Ödeme başarılı olunca plan mevcut fulfill/v2 yolundan (kind=plan_upgrade, 20261007001010) değişir; dönem değişmez.
 *  - Düşürme: dönem sonunda uygulanır (planlı değişiklik kaydı; cron `abonelik-kontrol`), iade YOK.
 * Yalnız ofis sahibi / genel müdür. Demo ödeme YOKTUR: iyzico yoksa reddedilir.
 */

export type PlanUpgradeResult = {
  error?: string;
  checkoutUrl?: string;
  quotedChargeTry?: number;
};

export type PlanChangeResult = { ok?: boolean; error?: string; message?: string };

const CHANGE_ROLES = ["owner", "gm"];
const CLOSED_MESSAGE = "Oransal paket değişikliği şu an etkin değil.";
const NOT_READY_MESSAGE = "Oransal paket değişikliği henüz etkin değil: yönetici hazırlığı tamamlanıyor.";

async function cardUserKeyForCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: string | undefined,
  wanted: boolean,
): Promise<string | null> {
  if (!wanted || (role !== "owner" && role !== "gm")) return null;
  return getTenantCardUserKey(supabase);
}

const DOWNGRADE_CODE_MESSAGES: Record<string, string> = {
  disabled: CLOSED_MESSAGE,
  not_owner: "Paketi yalnızca ofis sahibi veya genel müdür değiştirebilir.",
  invalid_plan: "Geçersiz paket.",
  no_subscription: "Abonelik kaydı bulunamadı.",
  not_active: "Planlı düşürme yalnızca aktif ücretli abonelikte yapılır.",
  same_plan: "Zaten bu paketi kullanıyorsunuz.",
  not_downgrade: "Seçilen paket mevcut paketten daha ucuz değil.",
  nothing_scheduled: "Planlı bir paket değişikliği yok.",
};

export async function startPlanUpgrade(formData: FormData): Promise<PlanUpgradeResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda paket değiştirilemez." };
  if (!CHANGE_ROLES.includes(gate.role)) {
    return { error: "Paketi yalnızca ofis sahibi veya genel müdür değiştirebilir." };
  }

  const toPlan = String(formData.get("plan") ?? "").trim();
  if (!isPlanId(toPlan)) return { error: "Geçersiz paket." };
  const confirmRaw = String(formData.get("confirm_try") ?? "").trim();
  const confirmTry = confirmRaw === "" ? null : Number(confirmRaw);
  const useCredit = String(formData.get("use_credit") ?? "") === "1";

  const { allowed } = await checkRateLimit(`planupg:${gate.userId}`, { limit: 8, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin." };

  if (!(await isPlanChangeEnabled())) return { error: CLOSED_MESSAGE };
  const support = await getPlanSupport();
  if (!support.upgradeReady) return { error: NOT_READY_MESSAGE };
  if (!isIyzicoConfigured()) {
    return { error: "Ödeme altyapısı yapılandırılmamış. Lütfen yönetici ile iletişime geçin." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Oturum bulunamadı." };

  const state = await loadPlanChangeState(supabase, gate.tenantId);
  if (!state) return { error: actionErrorMessage(null, "Abonelik bilgisi okunamadı.") };
  if (state.pause.paused) return { error: "Aboneliğiniz duraklatıldı; paket değiştirmek için önce devam ettirin." };
  if (state.status !== "active") {
    return { error: "Paket yükseltmek için ücretli bir abonelik aktif olmalı (deneme veya gecikmiş abonelikte kapalı)." };
  }

  const [plans, paidCap, { data: tenant }, { data: profile }] = await Promise.all([
    getPlanDefinitions(),
    loadPaidCapNetTry(supabase, gate.tenantId, state.subscriptionId),
    supabase.from("tenants").select("id, name, tax_number, phone, address_line, city").eq("id", gate.tenantId).maybeSingle(),
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
  ]);
  if (!tenant) return { error: "Ofis bulunamadı." };
  const toDef = plans.find((p) => p.id === toPlan);
  if (!toDef) return { error: "Paket bulunamadı." };

  const ev = evaluatePlanChange({
    plans,
    fromPlanId: state.planId,
    toPlanId: toPlan,
    cycle: state.cycle,
    lockedMonthlyTry: state.lockedMonthlyTry,
    paidCapNetTry: paidCap,
    periodStartMs: state.periodStartMs,
    periodEndMs: state.periodEndMs,
    nowMs: now(),
  });
  if (ev.status === "downgrade") {
    return { error: "Daha ucuz pakete geçiş dönem sonunda uygulanır; 'Dönem sonunda geç' seçeneğini kullanın. İade yapılmaz." };
  }
  if (ev.status !== "upgrade") return { error: ev.message };

  try {
    await assertBillingPlanPreflight(gate.tenantId, toPlan);
  } catch (error) {
    return { error: actionErrorMessage(error, "Paket kapasitesi doğrulanamadı.") };
  }

  if (confirmTry !== null && (!Number.isFinite(confirmTry) || Math.abs(confirmTry - ev.chargeNetTry) > 0.01)) {
    return { error: "Tutar güncellendi; lütfen yeni tutarı inceleyip yeniden onaylayın.", quotedChargeTry: ev.chargeNetTry };
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
    invoice = await createCheckoutInvoice({
      tenantId: gate.tenantId,
      subscriptionId: state.subscriptionId,
      plan: toPlan as PlanId,
      cycle: state.cycle,
      conversationId,
      amountTry: ev.chargeNetTry,
      kind: "plan_upgrade",
      extraMeta: {
        fromPlan: state.planId,
        chargeNetTry: ev.chargeNetTry,
        newPeriodTry: ev.toPeriodTry,
        creditTry: ev.creditTry,
        ratio: Math.round(ev.ratio * 10_000) / 10_000,
      },
      walletCredit: useCredit ? { userId: user.id, maxShare: await getTryMaxShare() } : null,
    });
  } catch (error) {
    return { error: actionErrorMessage(error, "Fatura taslağı oluşturulamadı.") };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "billing.plan_upgrade.checkout_started",
    entityType: "invoice",
    entityId: invoice.invoiceId,
    oldValue: { plan: state.planId },
    newValue: {
      plan: toPlan,
      cycle: state.cycle,
      chargeNetTry: ev.chargeNetTry,
      creditTry: ev.creditTry,
      invoiceTotalTry: invoice.totalTry,
      walletCreditTry: invoice.credit?.creditTry ?? 0,
    },
  });

  if (invoice.credit?.fullCredit) {
    try {
      await fulfillInvoiceWithWalletCredit({
        tenantId: gate.tenantId,
        plan: toPlan as PlanId,
        cycle: state.cycle,
        conversationId,
      });
    } catch (error) {
      await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
      return { error: actionErrorMessage(error, "Kredi ile ödeme tamamlanamadı.") };
    }
    revalidatePath("/app/abonelik");
    revalidatePath("/app/ayarlar");
    return { checkoutUrl: `${getBaseUrl()}/app/abonelik?paid=1&plan=${toPlan}`, quotedChargeTry: ev.chargeNetTry };
  }

  try {
    const chargeTry = invoice.credit ? invoice.credit.cashTry : invoice.totalTry;
    const init = await initializeCheckoutForm({
      conversationId,
      price: chargeTry,
      paidPrice: chargeTry,
      basketId: conversationId,
      callbackUrl: `${getBaseUrl()}/api/iyzico/callback`,
      buyer: checkoutBuyer.buyer,
      billingAddress: checkoutBuyer.billingAddress,
      basketItemName: `EmlakSoft ${toDef.name} paket yükseltme (oransal)`,
      cardUserKey: await cardUserKeyForCheckout(supabase, gate.role, String(formData.get("use_saved_card") ?? "") === "1"),
    });
    if (init.status !== "success" || !init.paymentPageUrl) {
      await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
      return { error: init.errorMessage || actionErrorMessage(null, "Ödeme oturumu açılamadı.") };
    }
    await markCheckoutInvoiceInitialized({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
    revalidatePath("/app/abonelik");
    return { checkoutUrl: init.paymentPageUrl, quotedChargeTry: ev.chargeNetTry };
  } catch (e) {
    await markCheckoutInvoiceFailed({ invoiceId: invoice.invoiceId, tenantId: gate.tenantId });
    console.error("startPlanUpgrade", e);
    return { error: actionErrorMessage(e, "Ödeme sayfası açılamadı") };
  }
}

/**
 * Daha ucuz pakete DÖNEM SONUNDA geçişi planlar. Kayıt DB'de tek işlemde denetimle yazılır (RPC `subscription_schedule_downgrade`,
 * JWT kimlikli). Kapasite ön denetimi burada, son hakem dönem sonunda DB kapasite tetikleyicisidir.
 */
export async function scheduleDowngrade(formData: FormData): Promise<PlanChangeResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda paket değiştirilemez." };
  if (!CHANGE_ROLES.includes(gate.role)) {
    return { error: DOWNGRADE_CODE_MESSAGES.not_owner };
  }
  const toPlan = String(formData.get("plan") ?? "").trim();
  if (!isPlanId(toPlan)) return { error: "Geçersiz paket." };

  const { allowed } = await checkRateLimit(`plandown:${gate.userId}`, { limit: 10, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin." };

  if (!(await isPlanChangeEnabled())) return { error: CLOSED_MESSAGE };
  if (!(await getPlanSupport()).pauseReady) return { error: NOT_READY_MESSAGE };

  const supabase = await createClient();
  const state = await loadPlanChangeState(supabase, gate.tenantId);
  if (!state) return { error: actionErrorMessage(null, "Abonelik bilgisi okunamadı.") };
  if (state.pause.paused) return { error: "Aboneliğiniz duraklatıldı; paket değiştirmek için önce devam ettirin." };

  const [plans, { count: used }, extraSeats] = await Promise.all([
    getPlanDefinitions(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", gate.tenantId).eq("is_active", true),
    getExtraSeats(supabase, gate.tenantId),
  ]);
  const ev = evaluatePlanChange({
    plans,
    fromPlanId: state.planId,
    toPlanId: toPlan,
    cycle: state.cycle,
    lockedMonthlyTry: state.lockedMonthlyTry,
    periodStartMs: state.periodStartMs,
    periodEndMs: state.periodEndMs,
    nowMs: now(),
    usedSeats: used ?? 0,
    extraSeats,
  });
  if (ev.status !== "downgrade") return { error: ev.message };

  try {
    await assertBillingPlanPreflight(gate.tenantId, toPlan);
  } catch (error) {
    return { error: actionErrorMessage(error, "Paket kapasitesi doğrulanamadı.") };
  }

  const { data, error } = await supabase.rpc("subscription_schedule_downgrade", { p_plan: toPlan });
  if (error) {
    console.error("scheduleDowngrade", { code: error.code, message: error.message });
    return { error: actionErrorMessage(error, "Planlı değişiklik kaydedilemedi.") };
  }
  const res = (data ?? {}) as { ok?: boolean; code?: string };
  if (res.ok !== true) {
    return { error: DOWNGRADE_CODE_MESSAGES[String(res.code ?? "")] ?? actionErrorMessage(null, "Planlı değişiklik kaydedilemedi.") };
  }
  revalidatePath("/app/abonelik");
  return { ok: true, message: `${plans.find((p) => p.id === toPlan)?.name ?? toPlan} paketine geçiş dönem sonunda uygulanacak.` };
}

export async function cancelScheduledDowngrade(): Promise<PlanChangeResult> {
  const gate = await requirePermission("billing", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating) return { error: "Destek oturumunda paket değiştirilemez." };
  if (!CHANGE_ROLES.includes(gate.role)) return { error: DOWNGRADE_CODE_MESSAGES.not_owner };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subscription_cancel_scheduled_downgrade");
  if (error) {
    console.error("cancelScheduledDowngrade", { code: error.code, message: error.message });
    return { error: actionErrorMessage(error, "Planlı değişiklik geri alınamadı.") };
  }
  const res = (data ?? {}) as { ok?: boolean; code?: string };
  if (res.ok !== true) {
    return { error: DOWNGRADE_CODE_MESSAGES[String(res.code ?? "")] ?? actionErrorMessage(null, "Planlı değişiklik geri alınamadı.") };
  }
  revalidatePath("/app/abonelik");
  return { ok: true, message: "Planlı paket değişikliği geri alındı." };
}
