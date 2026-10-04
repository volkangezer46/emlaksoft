import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import {
  GROWTH_FLAGS_OFF,
  GROWTH_SETTING_KEYS,
  describeRewardRule,
  isMissingTableError,
  parseGrowthFlags,
  type GrowthFlags,
  type RewardRuleView,
} from "@/lib/growth/settings";
import {
  generateReferralCode,
  hasAttribution,
  type SignupAttributionInput,
} from "@/lib/growth/attribution";

/**
 * Büyüme verisi (SUNUCU). Tablolar `supabase/proposed/` taslağındadır; uygulanmamışsa her okuyucu
 * `available:false` döner ve sayfa "etkin değil" uyarısı gösterir — sistem bozulmaz.
 * KVKK: IP/cihaz izi/kişisel veri SAKLANMAZ; atıf kaydı yalnız kod, kaynak etiketi ve zaman içerir.
 */

export async function getGrowthFlags(): Promise<GrowthFlags> {
  try {
    const raw = await getPlatformSettingsMany([
      GROWTH_SETTING_KEYS.referralEnabled,
      GROWTH_SETTING_KEYS.partnerEnabled,
    ]);
    return parseGrowthFlags(raw);
  } catch {
    return GROWTH_FLAGS_OFF;
  }
}

type RuleRow = RewardRuleView & { id: string };

function toRuleView(r: Record<string, unknown>): RuleRow {
  return {
    id: String(r.id),
    reward_type: r.reward_type === "percent_of_payment" ? "percent_of_payment" : "fixed_try",
    reward_value: Number(r.reward_value ?? 0),
    duration_months: r.duration_months == null ? null : Number(r.duration_months),
    hold_days: Number(r.hold_days ?? 0),
  };
}

/** Admin'in tanımladığı, şu an geçerli ve aktif ilk kural (yoksa null → ödül vaadi gösterilmez). */
async function activeRule(kind: "referral" | "partner"): Promise<RuleRow | null> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("growth_reward_rules")
    .select("id, reward_type, reward_value, duration_months, hold_days, valid_from, valid_until")
    .eq("kind", kind)
    .eq("is_active", true)
    .lte("valid_from", nowIso)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return null;
  const row = (data ?? []).find((r) => !r.valid_until || new Date(r.valid_until as string).getTime() > Date.parse(nowIso));
  return row ? toRuleView(row as Record<string, unknown>) : null;
}

export type ReferralInvite = { tenantId: string; at: string; paying: boolean };

export type ReferralOverview = {
  /** false: taslak tablolar yok (migration uygulanmadı). */
  available: boolean;
  enabled: boolean;
  code: string | null;
  clicks: number;
  invites: ReferralInvite[];
  rewardText: string | null;
};

/** Ofisin "Arkadaşını getir" özeti. tenantId MUTLAKA oturumdan gelir (RLS yerine açık süzgeç). */
export async function getReferralOverview(tenantId: string): Promise<ReferralOverview> {
  const empty: ReferralOverview = { available: false, enabled: false, code: null, clicks: 0, invites: [], rewardText: null };
  const flags = await getGrowthFlags();
  empty.enabled = flags.referralEnabled;
  const admin = createAdminClient();

  const codeRes = await admin.from("growth_referral_codes").select("code, is_active").eq("tenant_id", tenantId).maybeSingle();
  if (codeRes.error) {
    if (!isMissingTableError(codeRes.error)) console.error("getReferralOverview code", codeRes.error.message);
    return empty;
  }
  const code = codeRes.data?.is_active === false ? null : ((codeRes.data?.code as string | undefined) ?? null);

  const attrRes = await admin
    .from("signup_attributions")
    .select("tenant_id, created_at")
    .eq("referrer_tenant_id", tenantId)
    .eq("ref_kind", "referral")
    .order("created_at", { ascending: false })
    .limit(200);
  if (attrRes.error) return { ...empty, available: false };
  const referred = (attrRes.data ?? []).map((r) => ({ tenantId: r.tenant_id as string, at: r.created_at as string }));

  const payingIds = new Set<string>();
  if (referred.length) {
    const subs = await admin
      .from("subscriptions")
      .select("tenant_id, status")
      .in("tenant_id", referred.map((r) => r.tenantId))
      .eq("status", "active");
    for (const s of subs.data ?? []) payingIds.add(s.tenant_id as string);
  }

  let clicks = 0;
  if (code) {
    const c = await admin.from("growth_click_counters").select("n").eq("kind", "referral").eq("code", code);
    if (!c.error) clicks = (c.data ?? []).reduce((a, r) => a + Number(r.n ?? 0), 0);
  }

  const rule = flags.referralEnabled ? await activeRule("referral") : null;
  return {
    available: true,
    enabled: flags.referralEnabled,
    code,
    clicks,
    invites: referred.map((r) => ({ ...r, paying: payingIds.has(r.tenantId) })),
    rewardText: describeRewardRule(rule),
  };
}

/** Ofise opak davet kodu üretir (varsa mevcut olanı döner). Çakışmada yeniden dener. */
export async function ensureReferralCode(tenantId: string): Promise<{ code: string } | { error: string }> {
  const admin = createAdminClient();
  const existing = await admin.from("growth_referral_codes").select("code").eq("tenant_id", tenantId).maybeSingle();
  if (existing.error) {
    return { error: isMissingTableError(existing.error) ? "Davet programı henüz etkin değil." : "Davet kodu okunamadı." };
  }
  if (existing.data?.code) return { code: existing.data.code as string };
  for (let i = 0; i < 5; i++) {
    const code = generateReferralCode((n) => randomInt(n));
    const ins = await admin.from("growth_referral_codes").insert({ tenant_id: tenantId, code });
    if (!ins.error) return { code };
    if (ins.error.code !== "23505") return { error: "Davet kodu oluşturulamadı." };
    const again = await admin.from("growth_referral_codes").select("code").eq("tenant_id", tenantId).maybeSingle();
    if (again.data?.code) return { code: again.data.code as string };
  }
  return { error: "Davet kodu oluşturulamadı." };
}

/**
 * Yeni kayıt olan ofis için ilk-dokunuş atıfını yazar. ASLA fırlatmaz: kayıt akışını bozmamalıdır.
 * Program kapalıysa ofis daveti/ortak atfı yazılmaz (yalnız UTM etiketi saklanır).
 */
export async function recordSignupAttributionSafe(tenantId: string, input: SignupAttributionInput): Promise<void> {
  try {
    if (!hasAttribution(input)) return;
    const admin = createAdminClient();
    const flags = await getGrowthFlags();
    let refKind: string = "none";
    let referrerTenantId: string | null = null;
    let partnerId: string | null = null;

    const touch = input.touch;
    if (touch?.kind === "referral" && flags.referralEnabled) {
      const r = await admin.from("growth_referral_codes").select("tenant_id").eq("code", touch.code).eq("is_active", true).maybeSingle();
      if (r.data?.tenant_id && r.data.tenant_id !== tenantId) {
        refKind = "referral";
        referrerTenantId = r.data.tenant_id as string;
      }
    } else if (touch?.kind === "partner" && flags.partnerEnabled) {
      const p = await admin.from("growth_partners").select("id").eq("code", touch.code).eq("status", "active").maybeSingle();
      if (p.data?.id) {
        refKind = "partner";
        partnerId = p.data.id as string;
      }
    } else if (touch?.kind === "powered_by") {
      const t = await admin.from("tenants").select("id").eq("slug", touch.code).maybeSingle();
      if (t.data?.id && t.data.id !== tenantId) {
        refKind = "powered_by";
        referrerTenantId = t.data.id as string;
      }
    }
    if (refKind === "none" && !input.utm_source && !input.utm_medium && !input.utm_campaign) return;

    const { error } = await admin.from("signup_attributions").insert({
      tenant_id: tenantId,
      ref_kind: refKind,
      referrer_tenant_id: referrerTenantId,
      partner_id: partnerId,
      utm_source: input.utm_source,
      utm_medium: input.utm_medium,
      utm_campaign: input.utm_campaign,
      first_seen_at: new Date().toISOString(),
    });
    if (error && !isMissingTableError(error)) console.error("recordSignupAttribution", error.message);
  } catch (e) {
    console.error("recordSignupAttribution", e);
  }
}

/** Tıklama sayacı (yalnız kod + gün; kişisel veri yok). Hatalar yutulur. */
export async function countClickSafe(kind: "referral" | "partner" | "powered_by", code: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("growth_count_click", { p_kind: kind, p_code: code });
    if (error && !isMissingTableError(error)) console.error("countClick", error.message);
  } catch {
    /* sayaç kayıt akışını asla bozmaz */
  }
}

/** Ortak kodu aktif mi? (/p/<kod> yönlendirmesi için) */
export async function isActivePartnerCode(code: string): Promise<boolean> {
  try {
    const flags = await getGrowthFlags();
    if (!flags.partnerEnabled) return false;
    const admin = createAdminClient();
    const { data, error } = await admin.from("growth_partners").select("id").eq("code", code).eq("status", "active").maybeSingle();
    return !error && Boolean(data?.id);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ admin ------------------------------------------------------------------ */

export type AttributionRow = {
  tenantId: string;
  tenantName: string;
  refKind: string;
  utmSource: string | null;
  utmCampaign: string | null;
  partnerId: string | null;
  partnerName: string | null;
  at: string;
  paying: boolean;
};

export type PartnerRow = {
  id: string;
  name: string;
  type: string;
  code: string;
  status: string;
  contractSigned: boolean;
  signups: number;
  payers: number;
};

export type RuleAdminRow = RuleRow & {
  kind: string;
  name: string;
  monthly_cap_try: number | null;
  is_active: boolean;
};

export type AdminGrowthOverview = {
  available: boolean;
  flags: GrowthFlags;
  rows: AttributionRow[];
  capped: boolean;
  partners: PartnerRow[];
  rules: RuleAdminRow[];
  counts: { total: number; referral: number; partner: number; powered_by: number; none: number; payers: number };
};

const ROW_CAP = 1000;

export async function getAdminGrowthOverview(): Promise<AdminGrowthOverview> {
  const flags = await getGrowthFlags();
  const base: AdminGrowthOverview = {
    available: false,
    flags,
    rows: [],
    capped: false,
    partners: [],
    rules: [],
    counts: { total: 0, referral: 0, partner: 0, powered_by: 0, none: 0, payers: 0 },
  };
  const admin = createAdminClient();
  const attr = await admin
    .from("signup_attributions")
    .select("tenant_id, ref_kind, partner_id, utm_source, utm_campaign, created_at, tenants!signup_attributions_tenant_id_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (attr.error) {
    if (!isMissingTableError(attr.error)) console.error("getAdminGrowthOverview", attr.error.message);
    return base;
  }
  const list = attr.data ?? [];
  const ids = list.map((r) => r.tenant_id as string);
  const payingIds = new Set<string>();
  if (ids.length) {
    const subs = await admin.from("subscriptions").select("tenant_id").in("tenant_id", ids).eq("status", "active");
    for (const s of subs.data ?? []) payingIds.add(s.tenant_id as string);
  }
  const [partnersRes, rulesRes] = await Promise.all([
    admin.from("growth_partners").select("id, name, partner_type, code, status, contract_signed_at").order("created_at", { ascending: false }).limit(200),
    admin
      .from("growth_reward_rules")
      .select("id, kind, name, reward_type, reward_value, duration_months, hold_days, monthly_cap_try, is_active")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const partnerName = new Map<string, string>();
  for (const p of partnersRes.data ?? []) partnerName.set(p.id as string, p.name as string);

  const rows: AttributionRow[] = list.map((r) => {
    const t = r.tenants as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(t) ? t[0]?.name : t?.name;
    return {
      tenantId: r.tenant_id as string,
      tenantName: name ?? "Ofis",
      refKind: (r.ref_kind as string | null) ?? "none",
      utmSource: (r.utm_source as string | null) ?? null,
      utmCampaign: (r.utm_campaign as string | null) ?? null,
      partnerId: (r.partner_id as string | null) ?? null,
      partnerName: r.partner_id ? (partnerName.get(r.partner_id as string) ?? null) : null,
      at: r.created_at as string,
      paying: payingIds.has(r.tenant_id as string),
    };
  });
  const counts = { total: rows.length, referral: 0, partner: 0, powered_by: 0, none: 0, payers: 0 };
  for (const r of rows) {
    if (r.refKind === "referral") counts.referral++;
    else if (r.refKind === "partner") counts.partner++;
    else if (r.refKind === "powered_by") counts.powered_by++;
    else counts.none++;
    if (r.paying) counts.payers++;
  }

  const partners: PartnerRow[] = (partnersRes.data ?? []).map((p) => {
    const mine = list.filter((r) => r.partner_id === p.id);
    return {
      id: p.id as string,
      name: p.name as string,
      type: p.partner_type as string,
      code: p.code as string,
      status: p.status as string,
      contractSigned: Boolean(p.contract_signed_at),
      signups: mine.length,
      payers: mine.filter((r) => payingIds.has(r.tenant_id as string)).length,
    };
  });
  const rules: RuleAdminRow[] = (rulesRes.data ?? []).map((r) => ({
    ...toRuleView(r as Record<string, unknown>),
    kind: r.kind as string,
    name: r.name as string,
    monthly_cap_try: r.monthly_cap_try == null ? null : Number(r.monthly_cap_try),
    is_active: Boolean(r.is_active),
  }));

  return { available: true, flags, rows, capped: list.length >= ROW_CAP, partners, rules, counts };
}
