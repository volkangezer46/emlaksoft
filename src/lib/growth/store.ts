import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { tryCreditReady } from "@/lib/try-credits/wallet";
import {
  engineReady,
  grantWelcomeSafe,
  readAdminMetrics,
  readAdminQueue,
  readMyDashboard,
  readMyPartnerDashboard,
  readReferralSettings,
  type QueueFilter,
  type QueueRow,
  type ReferralSettings,
} from "@/lib/growth/engine";
import {
  computeGrowthMetrics,
  evaluateReadiness,
  type GrowthMetrics,
  type PartnerDashboard,
  type ReadinessCheck,
  type ReferralDashboard,
} from "@/lib/growth/program";
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
      GROWTH_SETTING_KEYS.cashPayoutEnabled,
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
    reward_type:
      r.reward_type === "percent_of_payment" ? "percent_of_payment" : r.reward_type === "monthly_multiple" ? "monthly_multiple" : "fixed_try",
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

export type ReferralOverview = {
  /** false: taslak tablolar yok (migration uygulanmadı). */
  available: boolean;
  enabled: boolean;
  code: string | null;
  /** growth_my_dashboard (motor migration'ı uygulanmamışsa null: pano yalnız kodu gösterir). */
  dashboard: ReferralDashboard | null;
  rewardText: string | null;
  /** Ofis bir ortağın sahibi ise ortak panosu. */
  partner: PartnerDashboard | null;
};

/**
 * Ofisin "Davet et ve kazan" panosu. tenantId MUTLAKA oturumdan gelir (RLS yerine açık süzgeç);
 * pano sayıları oturumlu RPC'den (yalnız kendi tenant'ı) gelir, kişisel veri içermez.
 */
export async function getReferralOverview(tenantId: string): Promise<ReferralOverview> {
  const empty: ReferralOverview = { available: false, enabled: false, code: null, dashboard: null, rewardText: null, partner: null };
  const flags = await getGrowthFlags();
  empty.enabled = flags.referralEnabled;
  const admin = createAdminClient();

  const codeRes = await admin.from("growth_referral_codes").select("code, is_active").eq("tenant_id", tenantId).maybeSingle();
  if (codeRes.error) {
    if (!isMissingTableError(codeRes.error)) console.error("getReferralOverview code", codeRes.error.message);
    return empty;
  }
  const code = codeRes.data?.is_active === false ? null : ((codeRes.data?.code as string | undefined) ?? null);

  const session = await createClient();
  const [dashboard, partner] = await Promise.all([readMyDashboard(session), readMyPartnerDashboard(session)]);
  const rule = flags.referralEnabled ? await activeRule("referral") : null;
  return {
    available: true,
    enabled: flags.referralEnabled,
    code,
    dashboard,
    rewardText: describeRewardRule(rule),
    partner,
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
    // Davet edilen ofise hoş geldin kredisi (ayar > 0, bayraksız çift, cüzdan hazırsa). Güvenli kanca: kaydı bozmaz.
    if (!error && refKind === "referral") await grantWelcomeSafe(admin, tenantId);
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
  /** Faz 2 alanları (motor migration'ı uygulanmamışsa false/null). */
  isTaxPayer: boolean;
  hasTaxNo: boolean;
  ownerTenantId: string | null;
  ruleId: string | null;
  pendingTry: number;
  payableTry: number;
  paidTry: number;
};

export type PayoutRow = {
  id: string;
  partnerId: string;
  partnerName: string;
  amountTry: number;
  method: string;
  status: string;
  documentNo: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type RuleAdminRow = RuleRow & {
  kind: string;
  name: string;
  monthly_cap_try: number | null;
  is_active: boolean;
};

export type GrowthReadiness = { referral: ReadinessCheck[]; partner: ReadinessCheck[]; cash: ReadinessCheck[] };

export type AdminGrowthOverview = {
  available: boolean;
  flags: GrowthFlags;
  rows: AttributionRow[];
  capped: boolean;
  partners: PartnerRow[];
  rules: RuleAdminRow[];
  counts: { total: number; referral: number; partner: number; powered_by: number; none: number; payers: number };
  /** Motor (20260826000600) hazırsa; değilse null (sayfa "motor etkin değil" der). */
  engine: boolean;
  metrics: GrowthMetrics | null;
  statusCounts: Record<string, number>;
  dueNow: number;
  partnerMoney: { approvedTry: number; paidTry: number } | null;
  queue: QueueRow[] | null;
  settings: ReferralSettings | null;
  payouts: PayoutRow[];
  readiness: GrowthReadiness;
};

const ROW_CAP = 1000;

function emptyReadiness(): GrowthReadiness {
  const base = {
    tablesReady: false,
    engineReady: false,
    walletReady: false,
    referralRuleDefined: false,
    cronFresh: null,
    welcomeConfigured: false,
    partnerRuleDefined: false,
    taxPayerPartnerExists: false,
  };
  return {
    referral: evaluateReadiness(base, "referral"),
    partner: evaluateReadiness(base, "partner"),
    cash: evaluateReadiness(base, "cash"),
  };
}

export async function getAdminGrowthOverview(opts: { queue?: QueueFilter | null } = {}): Promise<AdminGrowthOverview> {
  const flags = await getGrowthFlags();
  const base: AdminGrowthOverview = {
    available: false,
    flags,
    rows: [],
    capped: false,
    partners: [],
    rules: [],
    counts: { total: 0, referral: 0, partner: 0, powered_by: 0, none: 0, payers: 0 },
    engine: false,
    metrics: null,
    statusCounts: {},
    dueNow: 0,
    partnerMoney: null,
    queue: null,
    settings: null,
    payouts: [],
    readiness: emptyReadiness(),
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
  const PARTNER_BASE = "id, name, partner_type, code, status, contract_signed_at";
  const [partnersExt, rulesRes] = await Promise.all([
    admin
      .from("growth_partners")
      .select(`${PARTNER_BASE}, is_tax_payer, tax_no, owner_tenant_id, rule_id`)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("growth_reward_rules")
      .select("id, kind, name, reward_type, reward_value, duration_months, hold_days, monthly_cap_try, is_active")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  // Faz 2 sütunları (20260826000600) yoksa temel sütunlarla devam edilir.
  const partnersRes = partnersExt.error
    ? await admin.from("growth_partners").select(PARTNER_BASE).order("created_at", { ascending: false }).limit(200)
    : partnersExt;
  const partnerName = new Map<string, string>();
  for (const p of partnersRes.data ?? []) partnerName.set((p as { id: string }).id, (p as { name: string }).name);

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

  // Motor (talep/komisyon) verisi: ortak başına bekleyen/ödenebilir/ödenen komisyon.
  const isEngine = await engineReady(admin);
  const money = new Map<string, { pending: number; payable: number; paid: number }>();
  let partnerMoney: AdminGrowthOverview["partnerMoney"] = null;
  if (isEngine) {
    const comm = await admin
      .from("growth_reward_claims")
      .select("partner_id, status, amount_try, payout_id")
      .eq("component", "commission")
      .limit(5000);
    if (!comm.error) {
      let approved = 0;
      let paid = 0;
      for (const c of comm.data ?? []) {
        const id = c.partner_id as string;
        const amt = Number(c.amount_try ?? 0);
        const m = money.get(id) ?? { pending: 0, payable: 0, paid: 0 };
        if (c.status === "held" || c.status === "pending") m.pending += amt;
        else if (c.status === "approved" && !c.payout_id) {
          m.payable += amt;
          approved += amt;
        } else if (c.status === "paid") {
          m.paid += amt;
          paid += amt;
        }
        money.set(id, m);
      }
      partnerMoney = { approvedTry: approved, paidTry: paid };
    }
  }

  const partners: PartnerRow[] = (partnersRes.data ?? []).map((raw) => {
    const p = raw as Record<string, unknown>;
    const mine = list.filter((r) => r.partner_id === p.id);
    const m = money.get(p.id as string);
    return {
      id: p.id as string,
      name: p.name as string,
      type: p.partner_type as string,
      code: p.code as string,
      status: p.status as string,
      contractSigned: Boolean(p.contract_signed_at),
      signups: mine.length,
      payers: mine.filter((r) => payingIds.has(r.tenant_id as string)).length,
      isTaxPayer: p.is_tax_payer === true,
      hasTaxNo: Boolean(p.tax_no),
      ownerTenantId: (p.owner_tenant_id as string | null | undefined) ?? null,
      ruleId: (p.rule_id as string | null | undefined) ?? null,
      pendingTry: m?.pending ?? 0,
      payableTry: m?.payable ?? 0,
      paidTry: m?.paid ?? 0,
    };
  });
  const rules: RuleAdminRow[] = (rulesRes.data ?? []).map((r) => ({
    ...toRuleView(r as Record<string, unknown>),
    kind: r.kind as string,
    name: r.name as string,
    monthly_cap_try: r.monthly_cap_try == null ? null : Number(r.monthly_cap_try),
    is_active: Boolean(r.is_active),
  }));

  let metrics: GrowthMetrics | null = null;
  let statusCounts: Record<string, number> = {};
  let dueNow = 0;
  let queue: QueueRow[] | null = null;
  let settings: ReferralSettings | null = null;
  let payouts: PayoutRow[] = [];
  if (isEngine) {
    const [raw, q, st] = await Promise.all([readAdminMetrics(admin), readAdminQueue(admin, opts.queue ?? null, 100), readReferralSettings(admin)]);
    if (raw) {
      metrics = computeGrowthMetrics(raw);
      statusCounts = raw.status_counts;
      dueNow = raw.due_now;
    }
    queue = q;
    settings = st;
    const po = await admin
      .from("growth_partner_payouts")
      .select("id, partner_id, amount_try, method, status, document_no, paid_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!po.error) {
      payouts = (po.data ?? []).map((r) => ({
        id: r.id as string,
        partnerId: r.partner_id as string,
        partnerName: partnerName.get(r.partner_id as string) ?? "Ortak",
        amountTry: Number(r.amount_try ?? 0),
        method: r.method as string,
        status: (r.status as string | null) ?? "paid",
        documentNo: (r.document_no as string | null) ?? null,
        paidAt: (r.paid_at as string | null) ?? null,
        createdAt: r.created_at as string,
      }));
    }
  }

  // Hazırlık kontrolü (bayrak açmadan önce): migration, cüzdan, kural, cron, hoş geldin, ortak kuralı, vergi mükellefi ortak.
  const walletReady = await tryCreditReady(admin);
  const hb = await admin.from("cron_heartbeats").select("last_run_at, last_status").eq("job", "growth-claims").maybeSingle();
  const cronFresh = hb.error ? null : Boolean(hb.data?.last_run_at && Date.now() - Date.parse(hb.data.last_run_at as string) < 3 * 86_400_000 && hb.data.last_status === "ok");
  const input = {
    tablesReady: true,
    engineReady: isEngine,
    walletReady,
    referralRuleDefined: rules.some((r) => r.kind === "referral" && r.is_active),
    cronFresh,
    welcomeConfigured: (settings?.welcome_credit_try ?? 0) > 0,
    partnerRuleDefined: rules.some((r) => r.kind === "partner" && r.is_active),
    taxPayerPartnerExists: partners.some((p) => p.isTaxPayer && p.hasTaxNo && p.status === "active"),
  };
  const readiness: GrowthReadiness = {
    referral: evaluateReadiness(input, "referral"),
    partner: evaluateReadiness(input, "partner"),
    cash: evaluateReadiness(input, "cash"),
  };

  return {
    available: true,
    flags,
    rows,
    capped: list.length >= ROW_CAP,
    partners,
    rules,
    counts,
    engine: isEngine,
    metrics,
    statusCounts,
    dueNow,
    partnerMoney,
    queue,
    settings,
    payouts,
    readiness,
  };
}
