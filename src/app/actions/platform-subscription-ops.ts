"use server";

import { requireStepUp } from "@/lib/platform-security/step-up";
import { OFFICE_CLOSE_QUEUE_ONLY, officeCloseBlockedOutsideQueue } from "@/lib/platform-security/four-eyes";
import { statusChangeNeedsStepUp } from "@/lib/platform-security/step-up-policy";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { getSetting } from "@/lib/settings/read";
import { actionErrorMessage } from "@/lib/action-errors";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";
import { cleanReason } from "@/lib/billing/admin-billing-fixes";
import { invoiceAmountsTry } from "@/lib/billing/fulfillment";
import { IYZICO_CURRENCY } from "@/lib/billing/iyzico";
import { getPlanDefinition, getPlanDefinitions } from "@/lib/billing/plan-definitions";
import { isCatalogPlanKey } from "@/lib/billing/plan-overrides";
import { loadPaidCapNetTry } from "@/lib/billing/plan-change";
import { evaluatePause, PAUSE_ABSOLUTE_MAX_DAYS, resumedPeriodEndMs } from "@/lib/billing/pause-core";
import { evaluateSeatChange, type SeatChangeEval } from "@/lib/billing/seat-purchase-core";
import { parseSeatTiers } from "@/lib/billing/seat-purchase";
import { parseOverrideInput, describeOverride, resolveSeatLimit } from "@/lib/billing/entitlements/overrides";
import { revalidateTenantPublicPaths } from "@/lib/billing/revalidate-tenant-public";
import {
  cancelReasonText,
  isCancelReasonCode,
  lockedMonthlyAmount,
  parseDealInput,
  parseExpiryDate,
  previewAdminPlanChange,
  resolveQuoteTime,
  type AdminPlanChangePreview,
  type AdminPlanTiming,
  type AdminProration,
} from "@/lib/billing/subscription-ops-core";
import { readEntitlementOverrides, readOpsSubscription, type OpsSubRow } from "@/lib/billing/subscription-ops";

/**
 * ABONELİK OPERASYON KONSOLU (Ofis 360 > Abonelik): platform personelinin abonelik işlemleri.
 *
 * Kapı: "billing" platform modülü (requirePlatformModule; super_admin ve billing rolleri). Hedef ofis FormData'dan gelir
 * (personel seçimi; tasarım gereği kiracılar arası). HER işlem gerekçe ister (≥10 karakter) ve platform_audit_logs'a
 * önce/sonra değeriyle yazılır (/admin/aktivite). Yazmalar okunan değere KOŞULLUDUR (iyimser eşzamanlılık): bu arada
 * değişen abonelik ezilmez, "sayfayı yenileyin" döner. Para tahsil eden yol YOK: kıst fark yalnız açık fatura satırı
 * olarak kesilir (havale/POS ile Faturalama ekranından kapatılır, vadesi geçince hatırlatma akışına girer).
 */

export type SubOpsResult = { ok?: boolean; error?: string; message?: string };
/** `quotedAtMs`: önizlemenin hesaplandığı an; onay formu geri gönderir, onay aynı anla yeniden hesaplar. */
export type PlanPreviewResult = { error?: string; preview?: Extract<AdminPlanChangePreview, { ok: true }> & { totalTry: number; taxTry: number; quotedAtMs: number } };
export type SeatPreviewResult = {
  error?: string;
  preview?: {
    status: SeatChangeEval["status"];
    message: string;
    chargeNetTry: number;
    totalTry: number;
    fromTotal: number;
    toTotal: number;
    minTotal: number;
    maxTotal: number | null;
    quotedAtMs: number;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_SCHEMA = /commitment_end_at|cancel_reason_code|cancel_note|tenant_entitlement_overrides|column .* does not exist|relation .* does not exist|schema cache|PGRST20[45]/i;
const SCHEMA_PENDING = "Bu işlem için veritabanı hazırlığı (20261013004000) henüz uygulanmadı; değişiklik yapılmadı.";
const STALE = "Abonelik bu arada değişti; sayfayı yenileyip tekrar deneyin.";
const REASON_REQUIRED = "Gerekçe yazın (en az 10 karakter); denetim kaydına yazılır.";
const QUOTE_EXPIRED = "Önizleme 10 dakikadan eski ya da dönem bu arada yenilendi; yeniden önizleyip onaylayın.";

type Admin = ReturnType<typeof createAdminClient>;
type Ctx = { staff: Awaited<ReturnType<typeof requirePlatformModule>>; tenantId: string; reason: string; admin: Admin };

/** Ortak kapı: modül + hız sınırı + ofis kimliği + gerekçe. */
async function gate(action: string, formData: FormData, opts: { reasonField?: string; skipReason?: boolean } = {}): Promise<Ctx | { error: string }> {
  const staff = await requirePlatformModule("billing");
  const rl = await checkRateLimit(`sub-ops:${action}:${staff.id}`, { limit: 30, windowSec: 600, failurePolicy: "deny" });
  if (!rl.allowed) return { error: "Çok sık işlem yaptınız; birkaç dakika sonra tekrar deneyin." };
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!UUID_RE.test(tenantId)) return { error: "Ofis bulunamadı." };
  const reason = opts.skipReason ? "" : cleanReason(formData.get(opts.reasonField ?? "reason"));
  if (reason === null) return { error: REASON_REQUIRED };
  return { staff, tenantId, reason: reason ?? "", admin: createAdminClient() };
}

async function audit(ctx: Ctx, action: string, before: Record<string, unknown>, after: Record<string, unknown>, extra?: Record<string, unknown>) {
  await logPlatformActivity({
    actorId: ctx.staff.id,
    action: `subscription.${action}`,
    entityType: "tenant",
    entityId: ctx.tenantId,
    meta: { before, after, reason: ctx.reason, ...(extra ?? {}) },
  });
}

function revalidate(tenantId: string) {
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/tenants");
  revalidatePath("/admin/billing");
  revalidatePath("/admin");
}

async function loadSub(ctx: Ctx): Promise<{ row: OpsSubRow; opsColumns: boolean } | { error: string }> {
  const r = await readOpsSubscription(ctx.admin, ctx.tenantId);
  if (r.error) return { error: "Abonelik okunamadı; sayfayı yenileyip tekrar deneyin." };
  if (!r.row) return { error: "Bu ofisin abonelik kaydı yok." };
  return { row: r.row, opsColumns: r.opsColumns };
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};
const fmtDay = (iso: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(iso));

async function dueDays(): Promise<number> {
  try {
    const n = Number(await getSetting<number>("billing.admin_invoice_due_days"));
    return Number.isInteger(n) && n >= 1 && n <= 60 ? n : 7;
  } catch {
    return 7;
  }
}

/** Yönetici fark faturası: açık (open) satır, checkout yok; ödeme Faturalama ekranından elle kapatılır. */
async function createAdminInvoice(
  ctx: Ctx,
  input: { subscriptionId: string; netTry: number; prefix: string; meta: Record<string, unknown> },
): Promise<{ id: string; invoiceNo: string; totalTry: number } | { error: string }> {
  const amounts = invoiceAmountsTry(input.netTry);
  const nowMs = now();
  const invoiceNo = `${input.prefix}-${ctx.tenantId.replace(/-/g, "").slice(0, 6).toUpperCase()}-${randomBytes(5).toString("hex").toUpperCase()}`;
  const { data, error } = await ctx.admin
    .from("invoices")
    .insert({
      tenant_id: ctx.tenantId,
      subscription_id: input.subscriptionId,
      invoice_no: invoiceNo,
      status: "open",
      amount_try: amounts.amountTry,
      tax_try: amounts.taxTry,
      total_try: amounts.totalTry,
      currency: IYZICO_CURRENCY,
      due_at: new Date(nowMs + (await dueDays()) * 86_400_000).toISOString(),
      meta: { ...input.meta, source: "admin", created_by: ctx.staff.id, reason: ctx.reason },
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createAdminInvoice", error?.message);
    return { error: "Fatura satırı oluşturulamadı; Faturalama ekranından elle kesin." };
  }
  return { id: String(data.id), invoiceNo, totalTry: amounts.totalTry };
}

// ---------------------------------------------------------------------------
// Paket / durum (sayfa başı hızlı düzeltme) — gerekçeli
// ---------------------------------------------------------------------------

const TENANT_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;

export async function adminSetPlanStatus(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("plan-status", formData);
  if ("error" in ctx) return { error: ctx.error };
  const plan = String(formData.get("plan") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (plan && !(isCatalogPlanKey(plan) && (await getPlanDefinitions()).some((p) => p.id === plan))) return { error: "Geçersiz paket." };
  if (status && !(TENANT_STATUSES as readonly string[]).includes(status)) return { error: "Geçersiz durum." };

  const { data: tenant } = await ctx.admin.from("tenants").select("plan, status, slug").eq("id", ctx.tenantId).maybeSingle();
  if (!tenant) return { error: "Ofis bulunamadı." };
  if ((!plan || plan === tenant.plan) && (!status || status === tenant.status)) return { ok: true, message: "Değişiklik yok." };
  // AD11: askıya alma / iptal (ofis kapatma) kritik işlemdir; doğrulayıcı kodu sunucuda istenir.
  if (statusChangeNeedsStepUp(status, String(tenant.status ?? ""))) {
    if (await officeCloseBlockedOutsideQueue()) return { error: OFFICE_CLOSE_QUEUE_ONLY };
    const stepUp = await requireStepUp(formData, "office_close", ctx.staff.id);
    if (!stepUp.ok) return { error: stepUp.error };
  }

  const { data, error } = await ctx.admin.rpc("update_tenant_plan_subscription", {
    p_tenant_id: ctx.tenantId,
    p_actor_id: ctx.staff.id,
    p_plan: plan || null,
    p_status: status || null,
  });
  if (error) {
    console.error("adminSetPlanStatus", error.code, error.message);
    return { error: planLimitErrorMessage(error) ?? actionErrorMessage(null, "Paket ve durum güncellenemedi.") };
  }
  const res = (data ?? {}) as Record<string, unknown>;
  await audit(
    ctx,
    "plan_status",
    { plan: tenant.plan, status: tenant.status },
    { plan: res.plan ?? plan, status: res.status ?? status, monthly_amount_try: res.monthlyAmountTry ?? null },
  );
  revalidate(ctx.tenantId);
  revalidateTenantPublicPaths(typeof res.tenantSlug === "string" && res.tenantSlug ? res.tenantSlug : tenant.slug);
  return { ok: true, message: "Paket ve durum güncellendi." };
}

// ---------------------------------------------------------------------------
// İptal (dönem sonunda / hemen) ve iptal talebini geri alma
// ---------------------------------------------------------------------------

export async function adminCancelSubscription(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("cancel", formData, { reasonField: "note" });
  if ("error" in ctx) return { error: ctx.error };
  const mode = String(formData.get("mode") ?? "");
  if (mode !== "period_end" && mode !== "now") return { error: "İptal zamanını seçin (dönem sonunda ya da hemen)." };
  const code = String(formData.get("reason_code") ?? "");
  if (!isCancelReasonCode(code)) return { error: "İptal nedenini seçin." };
  // AD11: hemen iptal ofisi kapatır (kritik işlem); dönem sonu iptali gece kontrolüne kalır.
  if (mode === "now") {
    if (await officeCloseBlockedOutsideQueue()) return { error: OFFICE_CLOSE_QUEUE_ONLY };
    const stepUp = await requireStepUp(formData, "office_close", ctx.staff.id);
    if (!stepUp.ok) return { error: stepUp.error };
  }

  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row, opsColumns } = loaded;
  if (row.status === "cancelled") return { error: "Abonelik zaten iptal edilmiş." };
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const note = ctx.reason;
  const reasonCols = opsColumns
    ? { cancel_reason: cancelReasonText(code, note, true), cancel_reason_code: code, cancel_note: note }
    : { cancel_reason: cancelReasonText(code, note, false) };
  const before = {
    status: row.status,
    cancel_at_period_end: row.cancel_at_period_end,
    current_period_end: row.current_period_end,
    cancel_reason: row.cancel_reason,
  };

  if (mode === "period_end") {
    const endMs = ms(row.current_period_end);
    if (endMs == null || endMs <= nowMs) return { error: "Süren bir ödenmiş dönem yok; aboneliği hemen iptal edin." };
    if (row.pause_started_at) return { error: "Abonelik duraklatılmış; dönem sonu iptali için önce devam ettirin ya da hemen iptal edin." };
    const { data, error } = await ctx.admin
      .from("subscriptions")
      .update({ cancel_at_period_end: true, cancel_requested_at: nowIso, ...reasonCols, updated_at: nowIso })
      .eq("id", row.id)
      .eq("tenant_id", ctx.tenantId)
      .neq("status", "cancelled")
      .is("pause_started_at", null)
      .select("id");
    if (error) return { error: MISSING_SCHEMA.test(error.message) ? SCHEMA_PENDING : actionErrorMessage(null, "İptal kaydedilemedi.") };
    if ((data ?? []).length === 0) return { error: STALE };
    await audit(ctx, "cancel_at_period_end", before, { cancel_at_period_end: true, effective_at: row.current_period_end, ...reasonCols }, { reason_code: code });
    revalidate(ctx.tenantId);
    return { ok: true, message: `Abonelik ${fmtDay(row.current_period_end!)} tarihinde dönem sonunda iptal olacak; gece kontrolü durumu "iptal" yapar.` };
  }

  // Hemen: tek kaynak RPC (ofis + abonelik durumu, tutar korunur, ofis denetim kaydı) + neden alanları.
  const { data: rpcData, error: rpcError } = await ctx.admin.rpc("update_tenant_plan_subscription", {
    p_tenant_id: ctx.tenantId,
    p_actor_id: ctx.staff.id,
    p_plan: null,
    p_status: "cancelled",
  });
  if (rpcError) {
    console.error("adminCancelSubscription", rpcError.code, rpcError.message);
    return { error: actionErrorMessage(null, "Abonelik iptal edilemedi.") };
  }
  const extra = await ctx.admin
    .from("subscriptions")
    .update({ cancel_at_period_end: false, cancel_requested_at: nowIso, pause_started_at: null, pause_ends_at: null, ...reasonCols, updated_at: nowIso })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId);
  if (extra.error) console.error("adminCancelSubscription reason", extra.error.message);
  await audit(ctx, "cancel_now", before, { status: "cancelled", cancelled_at: nowIso, ...reasonCols }, { reason_code: code, reason_saved: !extra.error });
  revalidate(ctx.tenantId);
  // Ofis durumu iptal oldu: vitrin/ilan/danışman sayfaları ve sitemap önbellekte yayında kalmasın.
  const slug = (rpcData as Record<string, unknown> | null)?.tenantSlug;
  revalidateTenantPublicPaths(typeof slug === "string" ? slug : null);
  return {
    ok: true,
    message: extra.error ? "Abonelik iptal edildi; iptal nedeni kaydedilemedi (denetim kaydında var)." : "Abonelik ve ofis hemen iptal edildi.",
  };
}

export async function adminUndoCancel(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("undo-cancel", formData);
  if ("error" in ctx) return { error: ctx.error };
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row, opsColumns } = loaded;
  if (row.status === "cancelled") return { error: "Abonelik iptal edilmiş; geri almak için paket/durum düzeltmesini kullanın." };
  if (!row.cancel_at_period_end) return { error: "Bekleyen dönem sonu iptali yok." };
  const nowIso = new Date(now()).toISOString();
  const clear = opsColumns
    ? { cancel_at_period_end: false, cancel_requested_at: null, cancel_reason: null, cancel_reason_code: null, cancel_note: null }
    : { cancel_at_period_end: false, cancel_requested_at: null, cancel_reason: null };
  const { data, error } = await ctx.admin
    .from("subscriptions")
    .update({ ...clear, updated_at: nowIso })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("cancel_at_period_end", true)
    .neq("status", "cancelled")
    .select("id");
  if (error) return { error: actionErrorMessage(null, "İptal talebi geri alınamadı.") };
  if ((data ?? []).length === 0) return { error: STALE };
  await audit(ctx, "cancel_undone", { cancel_at_period_end: true, cancel_reason: row.cancel_reason }, { cancel_at_period_end: false });
  revalidate(ctx.tenantId);
  return { ok: true, message: "Dönem sonu iptali geri alındı; abonelik yenilenmeye devam eder." };
}

// ---------------------------------------------------------------------------
// Duraklatma / devam (pause-core kuralları; yönetici yıllık sınırdan muaf, en çok 90 gün)
// ---------------------------------------------------------------------------

export async function adminPauseSubscription(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("pause", formData);
  if ("error" in ctx) return { error: ctx.error };
  const days = Number(String(formData.get("days") ?? "").trim());
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  const nowMs = now();
  const decision = evaluatePause({
    // Yönetici işlemi: özellik bayrağı ve "yalnız sahip" kuralı uygulanmaz; yıllık 1 kez sınırı yöneticiyi bağlamaz.
    enabled: true,
    role: "owner",
    status: row.status,
    periodEndMs: ms(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    pausedAtMs: ms(row.pause_started_at),
    lastStartedMs: null,
    maxDays: PAUSE_ABSOLUTE_MAX_DAYS,
    days,
    nowMs,
  });
  if (!decision.ok) return { error: decision.message };
  const nowIso = new Date(nowMs).toISOString();
  const endsIso = new Date(decision.endsAtMs).toISOString();
  const { data, error } = await ctx.admin
    .from("subscriptions")
    // pause_last_started_at YAZILMAZ: yönetici duraklatması ofis sahibinin yıllık kendi duraklatma hakkını tüketmez.
    .update({ pause_started_at: nowIso, pause_ends_at: endsIso, updated_at: nowIso })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "active")
    .is("pause_started_at", null)
    .eq("cancel_at_period_end", false)
    .select("id");
  if (error) return { error: actionErrorMessage(null, "Abonelik duraklatılamadı.") };
  if ((data ?? []).length === 0) return { error: STALE };
  await audit(ctx, "pause", { pause_started_at: null, current_period_end: row.current_period_end }, { pause_started_at: nowIso, pause_ends_at: endsIso, days });
  revalidate(ctx.tenantId);
  return { ok: true, message: `Abonelik ${days} gün duraklatıldı (${fmtDay(endsIso)} tarihinde kendiliğinden devam eder). Ofis bu sürede salt-okunur.` };
}

export async function adminResumeSubscription(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("resume", formData);
  if ("error" in ctx) return { error: ctx.error };
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  const started = ms(row.pause_started_at);
  const ends = ms(row.pause_ends_at);
  if (started == null || ends == null) return { error: "Abonelik duraklatılmış değil." };
  const nowMs = now();
  const periodEnd = ms(row.current_period_end);
  const newEndIso = periodEnd == null ? null : new Date(resumedPeriodEndMs(periodEnd, started, ends, nowMs)).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await ctx.admin
    .from("subscriptions")
    .update({ current_period_end: newEndIso, pause_started_at: null, pause_ends_at: null, updated_at: nowIso })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("pause_started_at", row.pause_started_at!)
    .select("id");
  if (error) return { error: actionErrorMessage(null, "Abonelik devam ettirilemedi.") };
  if ((data ?? []).length === 0) return { error: STALE };
  await audit(
    ctx,
    "resume",
    { pause_started_at: row.pause_started_at, pause_ends_at: row.pause_ends_at, current_period_end: row.current_period_end },
    { pause_started_at: null, current_period_end: newEndIso },
  );
  revalidate(ctx.tenantId);
  return { ok: true, message: newEndIso ? `Abonelik devam ediyor; dönem sonu ${fmtDay(newEndIso)} oldu.` : "Abonelik devam ediyor." };
}

// ---------------------------------------------------------------------------
// Paket değişikliği (hemen / dönem sonunda; kıst hesapla / hesaplama) + bekleyen plan + dönem tipi
// ---------------------------------------------------------------------------

async function planPreview(ctx: Ctx, formData: FormData, nowMs: number): Promise<{ row: OpsSubRow; preview: AdminPlanChangePreview } | { error: string }> {
  const toPlan = String(formData.get("plan") ?? "").trim();
  if (!isCatalogPlanKey(toPlan)) return { error: "Geçersiz paket." };
  const timing: AdminPlanTiming = formData.get("timing") === "period_end" ? "period_end" : "now";
  const proration: AdminProration = formData.get("proration") === "none" ? "none" : "prorate";
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  const [plans, paidCap, seats, overrides] = await Promise.all([
    getPlanDefinitions(),
    loadPaidCapNetTry(ctx.admin, ctx.tenantId, row.id),
    ctx.admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("is_active", true),
    readEntitlementOverrides(ctx.admin, ctx.tenantId, nowMs),
  ]);
  const lock = Number(row.price_lock_try);
  const extraSeats = Number(row.extra_seats ?? 0) || 0;
  const target = plans.find((p) => p.id === toPlan);
  const preview = previewAdminPlanChange({
    plans,
    state: {
      planId: row.plan,
      status: row.status,
      cycle: row.billing_cycle === "yearly" ? "yearly" : "monthly",
      periodStartMs: ms(row.current_period_start),
      periodEndMs: ms(row.current_period_end),
      lockedMonthlyTry: Number.isFinite(lock) && lock > 0 ? lock : null,
      pendingPlan: row.pending_plan,
      paused: Boolean(row.pause_started_at),
      priceLockCampaign: row.price_lock_campaign,
    },
    toPlanId: toPlan,
    timing,
    proration,
    nowMs,
    paidCapNetTry: paidCap,
    usedSeats: seats.count ?? undefined,
    extraSeats,
    // Kapasite kontrolü DB tetikleyicisiyle aynı: yeni planın limiti ofise özel istisnayla çözülür (+ ek koltuk).
    targetSeatLimit: target ? resolveSeatLimit(target.limits.seats, extraSeats, overrides.rows, nowMs) : null,
  });
  return { row, preview };
}

/** Salt-okunur önizleme (yazma yok): kıst tutar, fatura net/KDV/toplam ve açıklama. */
export async function previewAdminPlanChangeAction(formData: FormData): Promise<PlanPreviewResult> {
  const ctx = await gate("plan-preview", formData, { skipReason: true });
  if ("error" in ctx) return { error: ctx.error };
  const quotedAtMs = now();
  const r = await planPreview(ctx, formData, quotedAtMs);
  if ("error" in r) return { error: r.error };
  if (!r.preview.ok) return { error: r.preview.error };
  const amounts = r.preview.invoiceNetTry > 0 ? invoiceAmountsTry(r.preview.invoiceNetTry) : { taxTry: 0, totalTry: 0 };
  return { preview: { ...r.preview, totalTry: amounts.totalTry, taxTry: amounts.taxTry, quotedAtMs } };
}

export async function applyAdminPlanChange(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("plan-change", formData);
  if ("error" in ctx) return { error: ctx.error };
  // Onay, önizlemenin hesaplandığı anla yeniden hesaplanır (kıst oran ms hassasiyetli; gerekçe yazarken kaymasın).
  const quoted = resolveQuoteTime(formData.get("quoted_at_ms"), now());
  if (quoted == null) return { error: QUOTE_EXPIRED };
  const r = await planPreview(ctx, formData, quoted);
  if ("error" in r) return { error: r.error };
  const { row, preview } = r;
  if (resolveQuoteTime(quoted, now(), ms(row.current_period_start)) == null) return { error: QUOTE_EXPIRED };
  if (!preview.ok) return { error: preview.error };
  const toPlan = String(formData.get("plan"));
  const confirmRaw = String(formData.get("confirm_net_try") ?? "").trim();
  if (confirmRaw === "" || Math.abs(Number(confirmRaw) - preview.invoiceNetTry) > 0.01) {
    return { error: "Önizlenen tutar değişti (dönem ilerledi ya da abonelik güncellendi). Yeniden önizleyip onaylayın." };
  }
  const before = {
    plan: row.plan,
    pending_plan: row.pending_plan,
    amount_try: row.amount_try,
    price_lock_try: row.price_lock_try,
    price_lock_campaign: row.price_lock_campaign,
    current_period_end: row.current_period_end,
  };
  const nowIso = new Date(now()).toISOString();

  if (preview.kind === "schedule") {
    const { data, error } = await ctx.admin
      .from("subscriptions")
      .update({ pending_plan: toPlan, pending_plan_effective_at: row.current_period_end, pending_plan_requested_by: null, updated_at: nowIso })
      .eq("id", row.id)
      .eq("tenant_id", ctx.tenantId)
      .eq("plan", row.plan)
      .is("pause_started_at", null)
      .select("id");
    if (error) return { error: actionErrorMessage(null, "Planlı paket değişikliği kaydedilemedi.") };
    if ((data ?? []).length === 0) return { error: STALE };
    await audit(
      ctx,
      "plan_scheduled",
      before,
      { pending_plan: toPlan, pending_plan_effective_at: row.current_period_end },
      { timing: "period_end", ...(preview.priceLockNote ? { price_lock_note: preview.priceLockNote } : {}) },
    );
    revalidate(ctx.tenantId);
    return { ok: true, message: preview.message };
  }

  const { data: rpc, error } = await ctx.admin.rpc("update_tenant_plan_subscription", {
    p_tenant_id: ctx.tenantId,
    p_actor_id: ctx.staff.id,
    p_plan: toPlan,
    p_status: null,
  });
  if (error) {
    console.error("applyAdminPlanChange", error.code, error.message);
    return { error: planLimitErrorMessage(error) ?? actionErrorMessage(null, "Paket değiştirilemedi.") };
  }
  // Bekleyen (dönem sonu) değişiklik artık geçersiz: temizlenir.
  if (row.pending_plan) {
    await ctx.admin
      .from("subscriptions")
      .update({ pending_plan: null, pending_plan_effective_at: null, pending_plan_requested_by: null, updated_at: nowIso })
      .eq("id", row.id)
      .eq("tenant_id", ctx.tenantId);
  }
  let invoice: { id: string; invoiceNo: string; totalTry: number } | null = null;
  let invoiceError: string | null = null;
  if (preview.invoiceNetTry > 0 && preview.evaluation) {
    const ev = preview.evaluation;
    const created = await createAdminInvoice(ctx, {
      subscriptionId: row.id,
      netTry: preview.invoiceNetTry,
      prefix: "ES-ADM-PLAN",
      meta: {
        kind: "admin_plan_change",
        fromPlan: row.plan,
        toPlan,
        cycle: row.billing_cycle,
        ratio: ev.ratio,
        creditTry: ev.creditTry,
        newCostTry: ev.newCostTry,
        chargeNetTry: ev.chargeNetTry,
        periodEnd: row.current_period_end,
      },
    });
    if ("error" in created) invoiceError = created.error;
    else invoice = created;
  }
  const res = (rpc ?? {}) as Record<string, unknown>;
  // Fiyat kilidi RPC'de yeniden yazılır/kaldırılır: denetim kaydına sonraki değeri okunarak yazılır.
  const lockAfter = row.price_lock_try != null
    ? await ctx.admin.from("subscriptions").select("price_lock_try, price_lock_campaign").eq("id", row.id).maybeSingle()
    : null;
  await audit(
    ctx,
    "plan_change",
    before,
    {
      plan: toPlan,
      monthly_amount_try: res.monthlyAmountTry ?? null,
      ...(lockAfter && !lockAfter.error
        ? { price_lock_try: lockAfter.data?.price_lock_try ?? null, price_lock_campaign: lockAfter.data?.price_lock_campaign ?? null }
        : {}),
      invoice_id: invoice?.id ?? null,
      invoice_total_try: invoice?.totalTry ?? 0,
    },
    {
      timing: "now",
      proration: formData.get("proration") === "none" ? "none" : "prorate",
      downgrade_credit_info_try: preview.downgradeCreditInfoTry,
      ...(invoiceError ? { invoice_error: invoiceError } : {}),
    },
  );
  revalidate(ctx.tenantId);
  revalidateTenantPublicPaths(typeof res.tenantSlug === "string" ? res.tenantSlug : null);
  if (invoiceError) return { ok: true, message: "Paket değişti ama fark faturası oluşturulamadı; Faturalama ekranından elle kesin (denetim kaydında tutar var)." };
  return {
    ok: true,
    message: invoice
      ? `Paket değişti; ${invoice.invoiceNo} numaralı ${invoice.totalTry.toLocaleString("tr-TR")} ₺ (KDV dahil) fark faturası açıldı.`
      : "Paket değişti; fatura kesilmedi.",
  };
}

export async function adminCancelPendingPlan(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("pending-cancel", formData);
  if ("error" in ctx) return { error: ctx.error };
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  if (!row.pending_plan) return { error: "Planlı paket değişikliği yok." };
  const { data, error } = await ctx.admin
    .from("subscriptions")
    .update({ pending_plan: null, pending_plan_effective_at: null, pending_plan_requested_by: null, updated_at: new Date(now()).toISOString() })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("pending_plan", row.pending_plan)
    .select("id");
  if (error) return { error: actionErrorMessage(null, "Planlı değişiklik geri alınamadı.") };
  if ((data ?? []).length === 0) return { error: STALE };
  await audit(ctx, "plan_schedule_cancelled", { pending_plan: row.pending_plan, pending_plan_effective_at: row.pending_plan_effective_at }, { pending_plan: null });
  revalidate(ctx.tenantId);
  return { ok: true, message: "Dönem sonu paket değişikliği geri alındı." };
}

export async function adminChangeBillingCycle(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("cycle", formData);
  if ("error" in ctx) return { error: ctx.error };
  const cycle = String(formData.get("cycle") ?? "");
  if (cycle !== "monthly" && cycle !== "yearly") return { error: "Dönem tipini seçin." };
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  if (row.billing_cycle === cycle) return { ok: true, message: "Dönem tipi zaten bu." };
  const { data, error } = await ctx.admin
    .from("subscriptions")
    .update({ billing_cycle: cycle, updated_at: new Date(now()).toISOString() })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("billing_cycle", row.billing_cycle)
    .select("id");
  if (error) return { error: actionErrorMessage(null, "Dönem tipi değiştirilemedi.") };
  if ((data ?? []).length === 0) return { error: STALE };
  await audit(ctx, "billing_cycle", { billing_cycle: row.billing_cycle }, { billing_cycle: cycle });
  revalidate(ctx.tenantId);
  return { ok: true, message: `Dönem tipi ${cycle === "yearly" ? "yıllık" : "aylık"} oldu; bir sonraki yenilemeden itibaren geçerli (mevcut dönem değişmez).` };
}

// ---------------------------------------------------------------------------
// Ek koltuk (extra_seats): seat-purchase-core ile aynı kıst hesabı
// ---------------------------------------------------------------------------

async function seatPreview(ctx: Ctx, formData: FormData, nowMs: number): Promise<{ row: OpsSubRow; ev: SeatChangeEval; target: number; included: number } | { error: string }> {
  const raw = String(formData.get("extra_seats") ?? "").trim();
  if (!/^[0-9]{1,3}$/.test(raw)) return { error: "Ek koltuk için 0-500 arası bir tam sayı girin." };
  const targetExtra = Number(raw);
  if (targetExtra > 500) return { error: "Ek koltuk en çok 500 olabilir." };
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row } = loaded;
  const [plans, def, seats] = await Promise.all([
    getPlanDefinitions(),
    getPlanDefinition(row.plan),
    ctx.admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("is_active", true),
  ]);
  const included = def.limits.seats;
  const current = Math.max(0, Number(row.extra_seats ?? 0) || 0);
  const baseLock = Number(row.seat_price_lock_base_try);
  const ev = evaluateSeatChange({
    plans,
    planId: def.id,
    cycle: row.billing_cycle === "yearly" ? "yearly" : "monthly",
    usedSeats: seats.count ?? 0,
    currentTotalSeats: included + current,
    targetTotalSeats: included + targetExtra,
    locks: {
      baseMonthlyTry: Number.isFinite(baseLock) && baseLock > 0 ? baseLock : null,
      tiers: parseSeatTiers(row.seat_price_lock_tiers),
    },
    periodStartMs: ms(row.current_period_start),
    periodEndMs: ms(row.current_period_end),
    nowMs,
  });
  return { row, ev, target: targetExtra, included };
}

export async function previewAdminSeatChange(formData: FormData): Promise<SeatPreviewResult> {
  const ctx = await gate("seat-preview", formData, { skipReason: true });
  if ("error" in ctx) return { error: ctx.error };
  const quotedAtMs = now();
  const r = await seatPreview(ctx, formData, quotedAtMs);
  if ("error" in r) return { error: r.error };
  const net = r.ev.status === "increase" ? r.ev.immediateChargeTry : 0;
  return {
    preview: {
      status: r.ev.status,
      message: r.ev.message,
      chargeNetTry: net,
      totalTry: net > 0 ? invoiceAmountsTry(net).totalTry : 0,
      fromTotal: r.ev.fromQuote.totalSeats,
      toTotal: r.ev.toQuote.totalSeats,
      minTotal: r.ev.minTotalSeats,
      maxTotal: Number.isFinite(r.ev.maxTotalSeats) ? r.ev.maxTotalSeats : null,
      quotedAtMs,
    },
  };
}

export async function applyAdminSeatChange(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("seat-change", formData);
  if ("error" in ctx) return { error: ctx.error };
  const quoted = resolveQuoteTime(formData.get("quoted_at_ms"), now());
  if (quoted == null) return { error: QUOTE_EXPIRED };
  const r = await seatPreview(ctx, formData, quoted);
  if ("error" in r) return { error: r.error };
  const { row, ev, target } = r;
  if (resolveQuoteTime(quoted, now(), ms(row.current_period_start)) == null) return { error: QUOTE_EXPIRED };
  if (ev.status === "no_change") return { ok: true, message: "Koltuk sayısı değişmiyor." };
  if (ev.status === "not_sold" || ev.status === "over_max") {
    return { error: `${ev.message} Ofise özel ek kullanıcı için "Limit istisnası" kullanın.` };
  }
  if (ev.status === "below_used" || ev.status === "below_included") return { error: ev.message };
  const billing = formData.get("billing") === "invoice" ? "invoice" : "free";
  const net = ev.status === "increase" && billing === "invoice" ? ev.immediateChargeTry : 0;
  const confirmRaw = String(formData.get("confirm_net_try") ?? "").trim();
  if (billing === "invoice" && (confirmRaw === "" || Math.abs(Number(confirmRaw) - net) > 0.01)) {
    return { error: "Önizlenen tutar değişti; yeniden önizleyip onaylayın." };
  }
  const from = Math.max(0, Number(row.extra_seats ?? 0) || 0);
  const { data, error } = await ctx.admin
    .from("subscriptions")
    .update({ extra_seats: target, updated_at: new Date(now()).toISOString() })
    .eq("id", row.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("extra_seats", from)
    .select("id");
  if (error) return { error: actionErrorMessage(null, "Ek koltuk güncellenemedi.") };
  if ((data ?? []).length === 0) return { error: STALE };
  let invoiceNote = "";
  let invoiceId: string | null = null;
  if (net > 0) {
    const created = await createAdminInvoice(ctx, {
      subscriptionId: row.id,
      netTry: net,
      prefix: "ES-ADM-SEAT",
      meta: { kind: "admin_extra_seats", fromExtraSeats: from, toExtraSeats: target, chargeNetTry: net, plan: row.plan, cycle: row.billing_cycle },
    });
    if ("error" in created) invoiceNote = " Fark faturası oluşturulamadı; Faturalama ekranından elle kesin.";
    else {
      invoiceId = created.id;
      invoiceNote = ` ${created.invoiceNo} numaralı ${created.totalTry.toLocaleString("tr-TR")} ₺ (KDV dahil) fark faturası açıldı.`;
    }
  }
  await audit(ctx, "extra_seats", { extra_seats: from }, { extra_seats: target, invoice_id: invoiceId, charge_net_try: net }, { billing });
  revalidate(ctx.tenantId);
  return { ok: true, message: `Ek koltuk ${from} → ${target}.${invoiceNote}` };
}

// ---------------------------------------------------------------------------
// Özel anlaşma: fiyat kilidi + koltuk taban kilidi + taahhüt bitişi
// ---------------------------------------------------------------------------

export async function saveSubscriptionDeal(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("deal", formData);
  if ("error" in ctx) return { error: ctx.error };
  const nowMs = now();
  const parsed = parseDealInput(
    { priceLock: formData.get("price_lock_try"), seatBase: formData.get("seat_base_try"), commitmentDate: formData.get("commitment_end") },
    nowMs,
  );
  if (!parsed.ok) return { error: parsed.error };
  const loaded = await loadSub(ctx);
  if ("error" in loaded) return loaded;
  const { row, opsColumns } = loaded;
  const wantsCommitment = parsed.commitmentEndIso !== null || Boolean(row.commitment_end_at);
  if (!opsColumns && wantsCommitment) return { error: SCHEMA_PENDING };

  const oldLock = Number(row.price_lock_try) > 0 ? Number(row.price_lock_try) : null;
  const oldSeat = Number(row.seat_price_lock_base_try) > 0 ? Number(row.seat_price_lock_base_try) : null;
  const patch: Record<string, unknown> = {};
  if (parsed.priceLockTry !== oldLock) {
    // Kayıtlı aylık tutar kilitle birlikte değişir (kilit liste fiyatını aşamaz; kaldırılınca liste fiyatı).
    const def = await getPlanDefinition(row.plan);
    patch.price_lock_try = parsed.priceLockTry;
    patch.amount_try = lockedMonthlyAmount(def.monthlyTry, parsed.priceLockTry);
  }
  if (parsed.seatBaseTry !== oldSeat) patch.seat_price_lock_base_try = parsed.seatBaseTry;
  if (opsColumns && (parsed.commitmentEndIso ?? null) !== (row.commitment_end_at ? new Date(row.commitment_end_at).toISOString() : null)) {
    patch.commitment_end_at = parsed.commitmentEndIso;
  }
  if (Object.keys(patch).length === 0) return { ok: true, message: "Değişiklik yok." };

  let q = ctx.admin.from("subscriptions").update({ ...patch, updated_at: new Date(nowMs).toISOString() }).eq("id", row.id).eq("tenant_id", ctx.tenantId);
  q = oldLock == null ? q.is("price_lock_try", null) : q.eq("price_lock_try", row.price_lock_try as number);
  const { data, error } = await q.select("id");
  if (error) return { error: MISSING_SCHEMA.test(error.message) ? SCHEMA_PENDING : actionErrorMessage(null, "Anlaşma kaydedilemedi.") };
  if ((data ?? []).length === 0) return { error: STALE };
  const before: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) before[k] = (row as Record<string, unknown>)[k] ?? null;
  await audit(ctx, "deal", before, patch);
  revalidate(ctx.tenantId);
  return { ok: true, message: "Özel anlaşma kaydedildi." };
}

// ---------------------------------------------------------------------------
// Limit istisnası (tenant_entitlement_overrides): ver / geri al
// ---------------------------------------------------------------------------

export async function grantEntitlementOverride(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("override-grant", formData);
  if ("error" in ctx) return { error: ctx.error };
  const parsed = parseOverrideInput({ key: formData.get("key"), kind: formData.get("kind"), amount: formData.get("amount") });
  if (!parsed.ok) return { error: parsed.error };
  const expiry = parseExpiryDate(formData.get("expires"), now());
  if (!expiry.ok) return { error: expiry.error };
  const { data, error } = await ctx.admin
    .from("tenant_entitlement_overrides")
    .insert({
      tenant_id: ctx.tenantId,
      key: parsed.key,
      delta: parsed.delta,
      value: parsed.value,
      expires_at: expiry.iso,
      reason: ctx.reason,
      created_by: ctx.staff.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("grantEntitlementOverride", error?.message);
    return { error: error && MISSING_SCHEMA.test(error.message) ? SCHEMA_PENDING : actionErrorMessage(null, "Limit istisnası kaydedilemedi.") };
  }
  const label = describeOverride({ key: parsed.key, delta: parsed.delta, value: parsed.value });
  await audit(ctx, "entitlement_override_granted", { override: null }, { override_id: data.id, key: parsed.key, delta: parsed.delta, value: parsed.value, expires_at: expiry.iso });
  revalidate(ctx.tenantId);
  return { ok: true, message: `${label} istisnası verildi${expiry.iso ? ` (${fmtDay(expiry.iso)} tarihine kadar)` : " (süresiz)"}.` };
}

export async function revokeEntitlementOverride(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("override-revoke", formData);
  if ("error" in ctx) return { error: ctx.error };
  const id = String(formData.get("override_id") ?? "").trim();
  if (!UUID_RE.test(id)) return { error: "İstisna bulunamadı." };
  const nowIso = new Date(now()).toISOString();
  const { data: cur } = await ctx.admin
    .from("tenant_entitlement_overrides")
    .select("id, key, delta, value, expires_at, revoked_at")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (!cur) return { error: "İstisna bulunamadı." };
  if (cur.revoked_at) return { error: "İstisna zaten geri alınmış." };
  const { data, error } = await ctx.admin
    .from("tenant_entitlement_overrides")
    .update({ revoked_at: nowIso, revoked_by: ctx.staff.id, revoke_reason: ctx.reason })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .is("revoked_at", null)
    .select("id");
  if (error) return { error: actionErrorMessage(null, "İstisna geri alınamadı.") };
  if ((data ?? []).length === 0) return { error: STALE };
  await audit(
    ctx,
    "entitlement_override_revoked",
    { override_id: id, key: cur.key, delta: cur.delta, value: cur.value, expires_at: cur.expires_at, revoked_at: null },
    { override_id: id, revoked_at: nowIso },
  );
  revalidate(ctx.tenantId);
  return { ok: true, message: "İstisna geri alındı; limit plan değerine döndü." };
}

// ---------------------------------------------------------------------------
// Otomatik yenileme: yönetici YALNIZ kapatabilir (açmak ofis sahibinin açık rızasını ister)
// ---------------------------------------------------------------------------

export async function adminDisableAutoRenew(_prev: SubOpsResult, formData: FormData): Promise<SubOpsResult> {
  const ctx = await gate("auto-renew-off", formData);
  if ("error" in ctx) return { error: ctx.error };
  const { data, error } = await ctx.admin
    .from("tenant_payment_profiles")
    .update({ auto_renew_enabled: false, updated_at: new Date(now()).toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("auto_renew_enabled", true)
    .select("tenant_id");
  if (error) return { error: actionErrorMessage(null, "Otomatik yenileme kapatılamadı.") };
  if ((data ?? []).length === 0) return { error: "Otomatik yenileme zaten kapalı." };
  await audit(ctx, "auto_renew_disabled", { auto_renew_enabled: true }, { auto_renew_enabled: false });
  revalidate(ctx.tenantId);
  return { ok: true, message: "Otomatik yenileme kapatıldı. Yeniden açmak için ofis sahibinin rızası gerekir (Abonelik ekranından)." };
}

