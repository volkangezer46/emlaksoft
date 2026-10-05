import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isMissingRpc } from "@/lib/try-credits/wallet";
import { parseAdminMetrics, parseDashboard, parsePartnerDashboard, type AdminMetricsRaw, type PartnerDashboard, type ReferralDashboard } from "./program";

/**
 * Referans/ortak motoru — RPC sarmalayıcıları. Bu dosya KENDİ service_role istemcisini YARATMAZ:
 * istemci ÇAĞIRAN tarafından verilir (allowlist'li mevcut işlevlerde kullanılan istemci; yeni createAdminClient YOK).
 * FAIL-SAFE: hiçbiri fırlatmaz; motor/RPC yoksa ya da hata olursa `null` döner. Ödeme akışı bu dosyadaki
 * hatalardan ASLA etkilenmez. Kişisel veri YAZILMAZ: yalnız kimlikler.
 * SQL: supabase/migrations/20260826000600_growth_referral_engine.sql (ad/parametre/anahtar BİREBİR; sözleşme testi).
 */

type Rpc = Pick<SupabaseClient, "rpc">;

export const GROWTH_RPC = {
  register: "growth_claim_register", //       (p_invoice uuid) -> jsonb RegisterOutcome; service_role
  welcome: "growth_grant_welcome", //         (p_referred uuid) -> jsonb; service_role
  process: "growth_claims_process", //        (p_limit integer default 200) -> jsonb ProcessSummary; service_role
  reverse: "growth_claims_reverse_for_invoice", // (p_invoice uuid, p_reason text) -> jsonb; service_role
  metrics: "growth_admin_metrics", //         () -> jsonb; service_role
  queue: "growth_admin_queue", //             (p_status text, p_limit integer) -> jsonb[]; service_role
  ready: "growth_engine_ready", //            () -> boolean; yalnız service_role kimliğinde true
  myDashboard: "growth_my_dashboard", //      () -> jsonb; oturumlu, YALNIZ kendi tenant'ı
  myPartner: "growth_my_partner_dashboard", // () -> jsonb | null; oturumlu
  invitePreview: "growth_invite_preview", //  (p_code text) -> jsonb | null; anon
  decide: "growth_admin_decide", //           (p_claim uuid, p_decision text, p_reason text) -> jsonb; personel oturumu (super_admin)
  saveSettings: "growth_admin_save_settings", // (p_values jsonb) -> jsonb; personel oturumu
  payoutCreate: "growth_admin_payout_create", // (p_partner uuid, p_method text, p_document_no text, p_paid_at date, p_note text) -> jsonb; personel oturumu
  partnerUpdate: "growth_admin_partner_update", // (p_partner uuid, p_values jsonb) -> jsonb; personel oturumu
} as const;

/** Ayar satırı anahtarları (growth_referral_settings sütunları; admin kaydeder). */
export const SETTINGS_KEYS = [
  "welcome_credit_try",
  "welcome_expires_days",
  "tier1_at",
  "tier1_bonus_months",
  "tier1_badge",
  "tier2_at",
  "tier2_bonus_months",
  "tier2_badge",
  "annual_cap_months",
  "velocity_max_per_day",
  "partner_tier1_max",
  "partner_tier1_pct",
  "partner_tier2_max",
  "partner_tier2_pct",
  "partner_tier3_pct",
  "partner_duration_months",
  "partner_min_payout_try",
  "min_cash_ratio",
  "manual_review_first_n",
] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

export type ReferralSettings = Record<Exclude<SettingsKey, "tier1_badge" | "tier2_badge">, number> & {
  tier1_badge: string;
  tier2_badge: string;
};

export const registerOutcomeSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  skipped: z.string().optional(),
  already: z.boolean().optional(),
  claim_id: z.string().uuid().optional(),
  status: z.string().optional(),
  flags: z.array(z.string()).optional(),
  pct: z.number().optional(),
});
export type RegisterOutcome = z.infer<typeof registerOutcomeSchema>;

export const processSummarySchema = z.object({
  ok: z.boolean(),
  wallet_ready: z.boolean(),
  registered: z.number(),
  reversed: z.number(),
  paid: z.number(),
  bonus: z.number(),
  blocked: z.number(),
  rejected: z.number(),
  clawback: z.number(),
  wallet_skipped: z.number(),
  partner_approved: z.number(),
  partner_payouts_credited: z.number(),
});
export type ProcessSummary = z.infer<typeof processSummarySchema>;

export const decisionResultSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  status: z.string().optional(),
  amount: z.number().optional(),
  net: z.number().optional(),
  min: z.number().optional(),
  payout_id: z.string().optional(),
});
export type DecisionResult = z.infer<typeof decisionResultSchema>;

async function call<T>(client: Rpc, fn: string, args: Record<string, unknown> | undefined, parse: (d: unknown) => T | null): Promise<T | null> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return null;
    return parse(data);
  } catch {
    return null;
  }
}

/** Ödeme sonrası kanca: ilk gerçek ödemede davet/ortak talebi üretir. İdempotent; ASLA fırlatmaz (ödemeyi bozmaz). */
export async function registerClaimSafe(client: Rpc, invoiceId: string | null | undefined): Promise<RegisterOutcome | null> {
  if (!invoiceId || !/^[0-9a-f-]{36}$/i.test(invoiceId)) return null;
  try {
    const { data, error } = await client.rpc(GROWTH_RPC.register, { p_invoice: invoiceId });
    if (error) {
      // Motor henüz uygulanmamış (migration yok): sessiz; diğer hatalar kayıt altına alınır, ödeme etkilenmez.
      if (!isMissingRpc(error)) console.error("growth registerClaim", { code: error.code });
      return null;
    }
    const p = registerOutcomeSchema.safeParse(data);
    return p.success ? p.data : null;
  } catch (e) {
    console.error("growth registerClaim", e instanceof Error ? e.name : "unknown");
    return null;
  }
}

/** İade/iptal sonrası: faturaya bağlı talepleri geri alır ve verilmiş krediyi clawback eder. */
export async function reverseClaimsForInvoiceSafe(client: Rpc, invoiceId: string, reason: string): Promise<boolean> {
  try {
    const { error } = await client.rpc(GROWTH_RPC.reverse, { p_invoice: invoiceId, p_reason: reason });
    if (error && !isMissingRpc(error)) console.error("growth reverseClaims", { code: error.code });
    return !error;
  } catch {
    return false;
  }
}

/** Davet edilen ofise hoş geldin kredisi (ayar > 0 ve program açıkken). İdempotent; ASLA fırlatmaz. */
export async function grantWelcomeSafe(client: Rpc, referredTenantId: string): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(GROWTH_RPC.welcome, { p_referred: referredTenantId });
    if (error) {
      if (!isMissingRpc(error)) console.error("growth grantWelcome", { code: error.code });
      return false;
    }
    return Boolean(data && typeof data === "object" && (data as { ok?: unknown }).ok === true && (data as { skipped?: unknown }).skipped == null);
  } catch {
    return false;
  }
}

/** Cron işleyicisi: kaçırılan talepler, iade geri alma, vadesi gelen ödül, kademe bonusu, clawback, ortak onayı. */
export async function processClaims(client: Rpc, limit = 200): Promise<ProcessSummary | null> {
  return call(client, GROWTH_RPC.process, { p_limit: limit }, (d) => {
    const p = processSummarySchema.safeParse(d);
    return p.success ? p.data : null;
  });
}

export async function engineReady(client: Rpc): Promise<boolean> {
  try {
    const { data, error } = await client.rpc(GROWTH_RPC.ready);
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function readAdminMetrics(client: Rpc): Promise<AdminMetricsRaw | null> {
  return call(client, GROWTH_RPC.metrics, undefined, parseAdminMetrics);
}

export type QueueRow = {
  id: string;
  status: string;
  component: string;
  amount_try: number;
  flags: string[];
  eligible_at: string | null;
  created_at: string;
  note: string | null;
  reversal_reason: string | null;
  granted_at: string | null;
  clawed_back_at: string | null;
  referred_tenant_id: string;
  beneficiary_tenant_id: string | null;
  partner_id: string | null;
  referred_name: string | null;
  beneficiary_name: string | null;
  partner_name: string | null;
};

const queueRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  component: z.string(),
  amount_try: z.coerce.number(),
  flags: z.array(z.string()).nullable().transform((v) => v ?? []),
  eligible_at: z.string().nullable(),
  created_at: z.string(),
  note: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  granted_at: z.string().nullable(),
  clawed_back_at: z.string().nullable(),
  referred_tenant_id: z.string(),
  beneficiary_tenant_id: z.string().nullable(),
  partner_id: z.string().nullable(),
  referred_name: z.string().nullable(),
  beneficiary_name: z.string().nullable(),
  partner_name: z.string().nullable(),
});

/** Kuyruk süzgeçleri (URL ?kuyruk=): durum adı ya da due (vadesi gelmiş) / flagged (bayraklı). */
export const QUEUE_FILTERS = ["pending", "held", "due", "flagged", "approved", "paid", "reversed", "rejected"] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export function parseQueueFilter(raw: string | null | undefined): QueueFilter | null {
  return (QUEUE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as QueueFilter) : null;
}

export async function readAdminQueue(client: Rpc, status: QueueFilter | null, limit = 100): Promise<QueueRow[] | null> {
  return call(client, GROWTH_RPC.queue, { p_status: status, p_limit: limit }, (d) => {
    if (!Array.isArray(d)) return null;
    const out: QueueRow[] = [];
    for (const r of d) {
      const p = queueRowSchema.safeParse(r);
      if (p.success) out.push(p.data);
    }
    return out;
  });
}

const settingsSchema = z.object({
  welcome_credit_try: z.coerce.number(),
  welcome_expires_days: z.coerce.number(),
  tier1_at: z.coerce.number(),
  tier1_bonus_months: z.coerce.number(),
  tier1_badge: z.string(),
  tier2_at: z.coerce.number(),
  tier2_bonus_months: z.coerce.number(),
  tier2_badge: z.string(),
  annual_cap_months: z.coerce.number(),
  velocity_max_per_day: z.coerce.number(),
  partner_tier1_max: z.coerce.number(),
  partner_tier1_pct: z.coerce.number(),
  partner_tier2_max: z.coerce.number(),
  partner_tier2_pct: z.coerce.number(),
  partner_tier3_pct: z.coerce.number(),
  partner_duration_months: z.coerce.number(),
  partner_min_payout_try: z.coerce.number(),
  min_cash_ratio: z.coerce.number(),
  manual_review_first_n: z.coerce.number(),
});

/** Ayar satırını okur (service_role tablosu; çağıranın admin istemcisi). Yok/hata = null. */
export async function readReferralSettings(
  client: Pick<SupabaseClient, "from">,
): Promise<ReferralSettings | null> {
  try {
    const { data, error } = await client.from("growth_referral_settings").select(SETTINGS_KEYS.join(", ")).eq("singleton", true).maybeSingle();
    if (error || !data) return null;
    const p = settingsSchema.safeParse(data);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

export async function readMyDashboard(client: Rpc): Promise<ReferralDashboard | null> {
  return call(client, GROWTH_RPC.myDashboard, undefined, parseDashboard);
}

export async function readMyPartnerDashboard(client: Rpc): Promise<PartnerDashboard | null> {
  return call(client, GROWTH_RPC.myPartner, undefined, parsePartnerDashboard);
}

export type InvitePreview = { office_name: string; welcome_credit_try: number };

/** Kayıt ekranı: davet kodu geçerliyse ofis adı + hoş geldin avantajı (program kapalıysa/kod yoksa null). */
export async function readInvitePreview(client: Rpc, code: string): Promise<InvitePreview | null> {
  return call(client, GROWTH_RPC.invitePreview, { p_code: code }, (d) => {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const o = d as Record<string, unknown>;
    if (typeof o.office_name !== "string" || !o.office_name) return null;
    const w = Number(o.welcome_credit_try ?? 0);
    return { office_name: o.office_name, welcome_credit_try: Number.isFinite(w) ? w : 0 };
  });
}

/** Personel RPC sonucu (decide/payout/save/partnerUpdate). Hata = {ok:false, code:'rpc_error'}. */
export async function staffRpc(client: Rpc, fn: string, args: Record<string, unknown>): Promise<DecisionResult> {
  try {
    const { data, error } = await client.rpc(fn, args);
    if (error) return { ok: false, code: error.code === "42501" ? "forbidden" : "rpc_error" };
    const p = decisionResultSchema.safeParse(data);
    return p.success ? p.data : { ok: false, code: "bad_result" };
  } catch {
    return { ok: false, code: "rpc_error" };
  }
}

export const DECISION_ERROR_TEXT: Record<string, string> = {
  forbidden: "Bu işlem yalnız süper admin içindir.",
  rpc_error: "İşlem tamamlanamadı; tablolar/işleyici etkin olmayabilir.",
  bad_result: "Beklenmeyen sonuç alındı.",
  reason_required: "Neden en az 3 karakter olmalı.",
  bad_decision: "Geçersiz karar.",
  not_found: "Talep bulunamadı.",
  not_approvable: "Yalnız inceleme kuyruğundaki (bayraklı) talep onaylanabilir; aynı ofis talebi onaylanamaz.",
  not_rejectable: "Bu durumdaki talep reddedilemez.",
  not_reversible: "Yalnız ödenmiş/onaylanmış talep geri alınabilir.",
  invalid_value: "Değer geçersiz.",
  bad_input: "Geçersiz giriş.",
  partner_program_off: "Ortak programı kapalı: önce 'Ortak programı' bayrağını açın.",
  cash_payout_off: "Nakit ortak ödemesi kapalı: ayrı 'Nakit ödeme' bayrağı açılmalı.",
  not_tax_payer: "Nakit ödeme yalnız vergi mükellefi ortağa yapılır (ortakta vergi bilgisi işaretlenmeli).",
  document_required: "Belge no ve ödeme tarihi zorunludur.",
  future_date: "Ödeme tarihi gelecekte olamaz.",
  no_owner_tenant: "Hesap kredisi için ortağa bağlı bir ofis tanımlayın.",
  below_min: "Ödenebilir bakiye minimum eşiğin altında.",
  partner_not_found: "Ortak bulunamadı.",
  owner_not_found: "Ofis bulunamadı.",
  rule_not_found: "Ortak kuralı bulunamadı.",
  bad_method: "Geçersiz ödeme yöntemi.",
};

export function decisionErrorText(code: string | undefined): string {
  return (code && DECISION_ERROR_TEXT[code]) || "İşlem tamamlanamadı.";
}
