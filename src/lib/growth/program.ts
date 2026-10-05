/**
 * Referans / ortaklık programı: SAF (DB'siz, sunucu-istemci ortak) tür, sözleşme ve hesap yardımcıları.
 *
 * SQL: supabase/migrations/20260826000600_growth_referral_engine.sql. RPC adı, parametre sırası ve dönüş
 * JSON anahtarları SQL ile BİREBİR (sözleşme testi: growth-engine-contract.test.ts).
 * Kural: ödül tutarı/oranı/kademe sayıları KODDA YOKTUR; hepsi `growth_reward_rules` + `growth_referral_settings`
 * satırlarından gelir. Bu dosya yalnız biçimlendirir ve türetir.
 * İstemci dosyaları bunu içe aktarabilir (zod/DB/phone-rules bağımlılığı YOK).
 */

/** Talep durumları (growth_reward_claims.status). */
export const CLAIM_STATUSES = ["pending", "held", "approved", "rejected", "reversed", "paid"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  pending: "İncelemede",
  held: "Bekleme süresinde",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  reversed: "Geri alındı",
  paid: "Ödendi",
};

export const CLAIM_COMPONENT_LABEL: Record<string, string> = {
  base: "Davet ödülü",
  tier1: "Kademe bonusu (1)",
  tier2: "Kademe bonusu (2)",
  commission: "Ortak komisyonu",
};

/** Kötüye kullanım / inceleme bayrakları (SQL growth_pair_flags + işleyici). */
export const CLAIM_FLAG_LABEL: Record<string, string> = {
  same_tenant: "Aynı ofis",
  same_tax_no: "Aynı vergi numarası",
  same_phone: "Aynı telefon",
  same_email_domain: "Aynı kurumsal e-posta alan adı",
  velocity: "Hız sınırı aşıldı",
  referrer_inactive: "Davetçi aboneliği aktif değil",
  clawback_due: "Ödenmiş komisyon geri alınacak",
  clawback_offset: "Geri alma sonraki ödemeden mahsup edildi",
};

/** Bayraklı (inceleme gerektiren) bir talep ödül almaz; yalnız bu bayraklar "engel" sayılır. */
export function flagLabel(flag: string): string {
  return CLAIM_FLAG_LABEL[flag] ?? flag;
}

/* ------------------------------------------------------------------ davet durumu (ofis panosu) ------------------------------------------------------------------ */

export const INVITE_STAGES = ["trial", "waiting", "paid", "cancelled"] as const;
export type InviteStage = (typeof INVITE_STAGES)[number];

export const INVITE_STAGE_LABEL: Record<InviteStage, string> = {
  trial: "Denemede",
  waiting: "Ödedi, bekleme süresinde",
  paid: "Ödül yüklendi",
  cancelled: "İptal / iade",
};

/** /app/buyume?durum=... filtre anahtarları (URL sözleşmesi). */
export const INVITE_FILTERS = ["tumu", "deneme", "bekliyor", "odedi", "iptal"] as const;
export type InviteFilter = (typeof INVITE_FILTERS)[number];

export const INVITE_FILTER_LABEL: Record<InviteFilter, string> = {
  tumu: "Tümü",
  deneme: "Denemede",
  bekliyor: "Bekliyor",
  odedi: "Ödül yüklendi",
  iptal: "İptal",
};

const FILTER_STAGE: Record<Exclude<InviteFilter, "tumu">, InviteStage> = {
  deneme: "trial",
  bekliyor: "waiting",
  odedi: "paid",
  iptal: "cancelled",
};

export function parseInviteFilter(raw: string | null | undefined): InviteFilter {
  return (INVITE_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as InviteFilter) : "tumu";
}

export function filterInvites<T extends { stage: InviteStage }>(invites: readonly T[], filter: InviteFilter): T[] {
  if (filter === "tumu") return [...invites];
  return invites.filter((i) => i.stage === FILTER_STAGE[filter]);
}

export function inviteFilterHref(filter: InviteFilter): string {
  return filter === "tumu" ? "/app/buyume#davetler" : `/app/buyume?durum=${filter}#davetler`;
}

/* ------------------------------------------------------------------ pano verisi (RPC growth_my_dashboard) ------------------------------------------------------------------ */

export type DashboardInvite = { at: string; stage: InviteStage; amount: number };

export type DashboardTiers = {
  tier1_at: number;
  tier1_bonus_months: number;
  tier1_badge: string;
  tier2_at: number;
  tier2_bonus_months: number;
  tier2_badge: string;
  annual_cap_months: number;
};

export type ReferralDashboard = {
  enabled: boolean;
  code: string | null;
  clicks: number;
  signups: number;
  trial: number;
  waiting: number;
  paid: number;
  cancelled: number;
  /** false = TL tutarları yalnız ofis sahibi/genel müdüre açık (earned/pending/davet tutarı 0 gelir). */
  money_visible: boolean;
  earned_try: number;
  pending_try: number;
  invites: DashboardInvite[];
  rule: { reward_type: string; reward_value: number; hold_days: number; credit_expires_days: number | null } | null;
  tiers: DashboardTiers;
  welcome_credit_try: number;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** RPC çıktısını güvenle çözer; beklenmeyen biçim = null (sayfa "etkin değil" kipine düşer). */
export function parseDashboard(raw: unknown): ReferralDashboard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const t = (r.tiers ?? {}) as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return null;
  const invitesRaw = Array.isArray(r.invites) ? r.invites : [];
  const invites: DashboardInvite[] = [];
  for (const i of invitesRaw) {
    const o = i as Record<string, unknown>;
    const stage = String(o.stage ?? "");
    if (!(INVITE_STAGES as readonly string[]).includes(stage)) continue;
    invites.push({ at: String(o.at ?? ""), stage: stage as InviteStage, amount: num(o.amount) });
  }
  const rule = r.rule && typeof r.rule === "object" ? (r.rule as Record<string, unknown>) : null;
  return {
    enabled: r.enabled,
    code: typeof r.code === "string" && r.code ? r.code : null,
    clicks: num(r.clicks),
    signups: num(r.signups),
    trial: num(r.trial),
    waiting: num(r.waiting),
    paid: num(r.paid),
    cancelled: num(r.cancelled),
    money_visible: r.money_visible !== false,
    earned_try: num(r.earned_try),
    pending_try: num(r.pending_try),
    invites,
    rule: rule
      ? {
          reward_type: String(rule.reward_type ?? ""),
          reward_value: num(rule.reward_value),
          hold_days: num(rule.hold_days),
          credit_expires_days: rule.credit_expires_days == null ? null : num(rule.credit_expires_days),
        }
      : null,
    tiers: {
      tier1_at: num(t.tier1_at),
      tier1_bonus_months: num(t.tier1_bonus_months),
      tier1_badge: String(t.tier1_badge ?? ""),
      tier2_at: num(t.tier2_at),
      tier2_bonus_months: num(t.tier2_bonus_months),
      tier2_badge: String(t.tier2_badge ?? ""),
      annual_cap_months: num(t.annual_cap_months),
    },
    welcome_credit_try: num(r.welcome_credit_try),
  };
}

/* ------------------------------------------------------------------ kademe / rozet ------------------------------------------------------------------ */

export type TierBadge = { key: "tier1" | "tier2"; label: string; at: number; bonusMonths: number; unlocked: boolean };
export type TierProgress = {
  badges: TierBadge[];
  /** Sıradaki kademe (yoksa null = hepsi açık). */
  next: { label: string; at: number; remaining: number; bonusMonths: number } | null;
  /** 0-100: sıradaki kademeye ilerleme (hepsi açıksa 100). */
  pct: number;
  /** Kazanılmış en yüksek rozet (yoksa null). */
  current: string | null;
};

/** `paid` = başarılı (ödül yüklenmiş) referans sayısı. Sayılar ve rozet adları yalnız ayar satırından gelir. */
export function tierProgress(paid: number, tiers: DashboardTiers): TierProgress {
  const all: TierBadge[] = [
    { key: "tier1", label: tiers.tier1_badge, at: tiers.tier1_at, bonusMonths: tiers.tier1_bonus_months, unlocked: paid >= tiers.tier1_at },
    { key: "tier2", label: tiers.tier2_badge, at: tiers.tier2_at, bonusMonths: tiers.tier2_bonus_months, unlocked: paid >= tiers.tier2_at },
  ];
  const list = all.filter((b) => b.at > 0);
  const nextBadge = list.find((b) => !b.unlocked) ?? null;
  const unlocked = list.filter((b) => b.unlocked);
  const prevAt = nextBadge ? ([...unlocked].pop()?.at ?? 0) : 0;
  const pct = nextBadge ? Math.max(0, Math.min(100, Math.round(((paid - prevAt) / Math.max(nextBadge.at - prevAt, 1)) * 100))) : 100;
  return {
    badges: list,
    next: nextBadge
      ? { label: nextBadge.label, at: nextBadge.at, remaining: Math.max(nextBadge.at - paid, 0), bonusMonths: nextBadge.bonusMonths }
      : null,
    pct,
    current: unlocked.length ? unlocked[unlocked.length - 1]!.label : null,
  };
}

/* ------------------------------------------------------------------ paylaşım (ticari ileti kuralı: EmlakSoft davetçi adına ileti ATMAZ) ------------------------------------------------------------------ */

/** Kısa davet bağlantısı: /r/<kod> (tıklama sayılır, çerez bırakır, /kayit'a yönlendirir). */
export function buildShortInviteUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/r/${encodeURIComponent(code)}`;
}

export function buildShareText(url: string): string {
  return `EmlakSoft ile ofisimi yönetiyorum. Denemek istersen: ${url}`;
}

/** Kullanıcı kendi WhatsApp'ından kendisi gönderir; sunucu ileti göndermez. */
export function buildWhatsAppHref(url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(buildShareText(url))}`;
}

/* ------------------------------------------------------------------ ölçüm (admin) ------------------------------------------------------------------ */

export type AdminMetricsRaw = {
  clicks: number;
  signups: number;
  referrers: number;
  payers: number;
  claims: number;
  flagged: number;
  reward_cost_try: number;
  first_payment_revenue_try: number;
  status_counts: Record<string, number>;
  due_now: number;
  partner: { claims: number; held: number; approved_try: number; paid_try: number };
};

export function parseAdminMetrics(raw: unknown): AdminMetricsRaw | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.signups == null || r.payers == null) return null;
  const sc = (r.status_counts ?? {}) as Record<string, unknown>;
  const p = (r.partner ?? {}) as Record<string, unknown>;
  return {
    clicks: num(r.clicks),
    signups: num(r.signups),
    referrers: num(r.referrers),
    payers: num(r.payers),
    claims: num(r.claims),
    flagged: num(r.flagged),
    reward_cost_try: num(r.reward_cost_try),
    first_payment_revenue_try: num(r.first_payment_revenue_try),
    status_counts: Object.fromEntries(Object.entries(sc).map(([k, v]) => [k, num(v)])),
    due_now: num(r.due_now),
    partner: { claims: num(p.claims), held: num(p.held), approved_try: num(p.approved_try), paid_try: num(p.paid_try) },
  };
}

export type GrowthMetrics = {
  clicks: number;
  signups: number;
  payers: number;
  /** tıklama -> kayıt (0-1; tıklama yoksa null) */
  clickToSignup: number | null;
  /** kayıt -> ilk gerçek ödeme (0-1; kayıt yoksa null) */
  signupToPaid: number | null;
  /** davet (kayıt) edilen / davetçi */
  invitesPerReferrer: number | null;
  /** davetçi başına ödeyen */
  payersPerReferrer: number | null;
  /** K-faktör = davet/davetçi x ödeme dönüşümü (K>=1: kendi kendini büyüten) */
  kFactor: number | null;
  rewardCostTry: number;
  firstPaymentRevenueTry: number;
  /** ödül maliyeti / ilk ödeme geliri (0-1; gelir yoksa null) */
  costRatio: number | null;
  /** ödül maliyetinin ilk ödeme gelirinden geri dönüş oranı (gelir / maliyet; maliyet yoksa null) */
  paybackMultiple: number | null;
  /** bayraklı talep / tüm talepler (0-1) */
  abuseRate: number | null;
};

function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export function computeGrowthMetrics(m: AdminMetricsRaw): GrowthMetrics {
  const conv = ratio(m.payers, m.signups);
  const per = ratio(m.signups, m.referrers);
  return {
    clicks: m.clicks,
    signups: m.signups,
    payers: m.payers,
    clickToSignup: ratio(m.signups, m.clicks),
    signupToPaid: conv,
    invitesPerReferrer: per,
    payersPerReferrer: ratio(m.payers, m.referrers),
    kFactor: per != null && conv != null ? per * conv : null,
    rewardCostTry: m.reward_cost_try,
    firstPaymentRevenueTry: m.first_payment_revenue_try,
    costRatio: ratio(m.reward_cost_try, m.first_payment_revenue_try),
    paybackMultiple: ratio(m.first_payment_revenue_try, m.reward_cost_try),
    abuseRate: ratio(m.flagged, m.claims),
  };
}

export function formatPercent(v: number | null): string {
  if (v == null) return "-";
  return `%${(v * 100).toFixed(1).replace(".", ",")}`;
}

export function formatDecimal(v: number | null, digits = 2): string {
  if (v == null) return "-";
  return v.toFixed(digits).replace(".", ",");
}

/* ------------------------------------------------------------------ aktivasyon: hazırlık kontrolü ------------------------------------------------------------------ */

export type ReadinessInput = {
  /** growth tabloları (000800/000900) okunabiliyor */
  tablesReady: boolean;
  /** growth_engine_ready() */
  engineReady: boolean;
  /** try_credit_ready() */
  walletReady: boolean;
  /** aktif referral kuralı var */
  referralRuleDefined: boolean;
  /** son 3 günde growth-claims cron kalp atışı */
  cronFresh: boolean | null;
  /** growth_referral_settings.welcome_credit_try > 0 */
  welcomeConfigured: boolean;
  /** aktif partner kuralı var (Faz 2) */
  partnerRuleDefined: boolean;
  /** vergi mükellefi işaretli aktif ortak var (nakit için) */
  taxPayerPartnerExists: boolean;
};

export type ReadinessCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** true: sağlanmadan bayrak AÇILAMAZ; false: uyarı */
  blocking: boolean;
  detail: string;
};

export type ReadinessTarget = "referral" | "partner" | "cash";

export function evaluateReadiness(input: ReadinessInput, target: ReadinessTarget = "referral"): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [
    {
      key: "migration",
      label: "Veritabanı hazır (referans motoru migration'ı)",
      ok: input.tablesReady && input.engineReady,
      blocking: true,
      detail: input.tablesReady && input.engineReady ? "Tablolar ve işleyici RPC'leri mevcut." : "20260825000800, 20260825000900 ve 20260826000600 migration'ları uygulanmadı.",
    },
    {
      key: "wallet",
      label: "TL hesap kredisi cüzdanı hazır",
      ok: input.walletReady,
      blocking: true,
      detail: input.walletReady ? "Cüzdan RPC'leri hazır." : "20260826000400/000500 migration'ları uygulanmadı; ödül yüklenemez.",
    },
    {
      key: "rule",
      label: "Aktif davet ödül kuralı tanımlı",
      ok: input.referralRuleDefined,
      blocking: true,
      detail: input.referralRuleDefined ? "Aktif kural var." : "Ödül kuralları bölümünden bir davet kuralı ekleyip aktif edin.",
    },
    {
      key: "cron",
      label: "Talep işleyicisi (growth-claims cron) çalışıyor",
      ok: input.cronFresh === true,
      blocking: false,
      detail: input.cronFresh === true ? "Son çalışma güncel." : "Cron henüz çalışmadı; bekleme süresi dolan ödüller yüklenmez.",
    },
    {
      key: "welcome",
      label: "Hoş geldin kredisi tanımlı",
      ok: input.welcomeConfigured,
      blocking: false,
      detail: input.welcomeConfigured ? "Davet edilene hoş geldin kredisi verilir." : "Tanımlı değil: davet edilen ofise avantaj gösterilmez (tek taraflı).",
    },
  ];
  if (target !== "referral") {
    checks.push({
      key: "partner_rule",
      label: "Aktif ortak komisyon kuralı tanımlı",
      ok: input.partnerRuleDefined,
      blocking: true,
      detail: input.partnerRuleDefined ? "Aktif ortak kuralı var." : "Ortak türünde bir kural ekleyin ve ortağa bağlayın.",
    });
  }
  if (target === "cash") {
    checks.push({
      key: "tax_payer",
      label: "Vergi mükellefi ortak tanımlı",
      ok: input.taxPayerPartnerExists,
      blocking: true,
      detail: input.taxPayerPartnerExists ? "Nakit ödemeye uygun ortak var." : "Nakit ödeme yalnız vergi mükellefine, fatura karşılığı yapılır.",
    });
  }
  return checks;
}

export function readinessBlockers(checks: readonly ReadinessCheck[]): ReadinessCheck[] {
  return checks.filter((c) => c.blocking && !c.ok);
}

/* ------------------------------------------------------------------ ortak (Faz 2) ------------------------------------------------------------------ */

export type PartnerSettings = {
  partner_tier1_max: number;
  partner_tier1_pct: number;
  partner_tier2_max: number;
  partner_tier2_pct: number;
  partner_tier3_pct: number;
};

/** Aktif ücretli müşteri sayısına göre komisyon yüzdesi (SQL growth_register_partner ile aynı eşikler). */
export function partnerTierPct(activeCustomers: number, s: PartnerSettings): number {
  if (activeCustomers <= s.partner_tier1_max) return s.partner_tier1_pct;
  if (activeCustomers <= s.partner_tier2_max) return s.partner_tier2_pct;
  return s.partner_tier3_pct;
}

export type PartnerDashboard = {
  name: string;
  code: string;
  status: string;
  program_enabled: boolean;
  cash_enabled: boolean;
  is_tax_payer: boolean;
  clicks: number;
  signups: number;
  payers: number;
  pending_try: number;
  payable_try: number;
  paid_try: number;
  clawback_due_try: number;
  tier_pct: number;
  next_tier_at: number | null;
  min_payout_try: number;
  duration_months: number;
};

export function parsePartnerDashboard(raw: unknown): PartnerDashboard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== "string") return null;
  return {
    name: String(r.name ?? ""),
    code: r.code,
    status: String(r.status ?? ""),
    program_enabled: r.program_enabled === true,
    cash_enabled: r.cash_enabled === true,
    is_tax_payer: r.is_tax_payer === true,
    clicks: num(r.clicks),
    signups: num(r.signups),
    payers: num(r.payers),
    pending_try: num(r.pending_try),
    payable_try: num(r.payable_try),
    paid_try: num(r.paid_try),
    clawback_due_try: num(r.clawback_due_try),
    tier_pct: num(r.tier_pct),
    next_tier_at: r.next_tier_at == null ? null : num(r.next_tier_at),
    min_payout_try: num(r.min_payout_try),
    duration_months: num(r.duration_months),
  };
}

/** Ortak bağlantısı: /p/<kod>. */
export function buildPartnerUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(code)}`;
}

/* ------------------------------------------------------------------ tetik anları (ürün içi, kapatılabilir davet kartı) ------------------------------------------------------------------ */

export const NUDGE_MOMENTS = ["first_deal", "first_valuation", "credit_purchase", "team_grew", "first_payment"] as const;
export type NudgeMoment = (typeof NUDGE_MOMENTS)[number];

export const NUDGE_COPY: Record<NudgeMoment, { title: string; text: string; cta: string }> = {
  first_deal: {
    title: "İlk anlaşmanızı kaydettiniz",
    text: "Bir meslektaşınız da EmlakSoft'u denemek isterse size özel davet bağlantınızı paylaşabilirsiniz.",
    cta: "Davet et ve kazan",
  },
  first_valuation: {
    title: "İlk değerleme raporunuz hazır",
    text: "Raporu beğendiyseniz meslektaşlarınıza da önerin; bağlantıyla gelen her ödeyen ofis için hesap krediniz yüklenir.",
    cta: "Davet et ve kazan",
  },
  credit_purchase: {
    title: "Kontör aldınız",
    text: "Ofisinizin bu işi nasıl hızlandırdığını bir meslektaşınıza anlatın; davet bağlantınız hazır.",
    cta: "Davet et ve kazan",
  },
  first_payment: {
    title: "İlk plan ödemeniz alındı",
    text: "Hoş geldiniz! EmlakSoft sizin için işe yaradıysa bir meslektaşınıza da önerin; davet bağlantınızla gelen her ödeyen ofis için hesap krediniz yüklenir.",
    cta: "Davet et ve kazan",
  },
  team_grew: {
    title: "Ekibiniz büyüyor",
    text: "Tanıdığınız başka ofisleri de davet edin: bağlantınızla gelen ofisler ödeme yaptığında hesap krediniz yüklenir.",
    cta: "Başka ofisleri davet et",
  },
};

export function nudgeStorageKey(moment: NudgeMoment): string {
  return `emlaksoft:growth-nudge:${moment}`;
}
