import { describe, expect, it } from "vitest";
import {
  buildPartnerUrl,
  buildShareText,
  buildShortInviteUrl,
  buildWhatsAppHref,
  computeGrowthMetrics,
  evaluateReadiness,
  filterInvites,
  flagLabel,
  formatDecimal,
  formatPercent,
  inviteFilterHref,
  nudgeStorageKey,
  parseAdminMetrics,
  parseDashboard,
  parseInviteFilter,
  parsePartnerDashboard,
  partnerTierPct,
  readinessBlockers,
  tierProgress,
  NUDGE_COPY,
  NUDGE_MOMENTS,
  type DashboardTiers,
  type ReadinessInput,
} from "./program";

const TIERS: DashboardTiers = {
  tier1_at: 3,
  tier1_bonus_months: 0.5,
  tier1_badge: "Gümüş Elçi",
  tier2_at: 10,
  tier2_bonus_months: 2,
  tier2_badge: "Altın Elçi",
  annual_cap_months: 12,
};

describe("kademe ve rozet", () => {
  it("rozetler yalnız sayımdan türetilir; sıradaki kademe ve ilerleme", () => {
    const p0 = tierProgress(0, TIERS);
    expect(p0.current).toBeNull();
    expect(p0.next).toMatchObject({ label: "Gümüş Elçi", at: 3, remaining: 3 });
    expect(p0.pct).toBe(0);

    const p2 = tierProgress(2, TIERS);
    expect(p2.pct).toBe(67);
    expect(p2.next?.remaining).toBe(1);

    const p3 = tierProgress(3, TIERS);
    expect(p3.current).toBe("Gümüş Elçi");
    expect(p3.badges.map((b) => b.unlocked)).toEqual([true, false]);
    expect(p3.next).toMatchObject({ label: "Altın Elçi", remaining: 7 });
    expect(p3.pct).toBe(0);

    const p10 = tierProgress(12, TIERS);
    expect(p10.current).toBe("Altın Elçi");
    expect(p10.next).toBeNull();
    expect(p10.pct).toBe(100);
  });

  it("tanımsız (0) kademe gösterilmez", () => {
    const p = tierProgress(1, { ...TIERS, tier1_at: 0 });
    expect(p.badges.map((b) => b.key)).toEqual(["tier2"]);
  });
});

describe("davet süzgeci (URL sözleşmesi)", () => {
  const invites = [
    { at: "2026-01-01", stage: "trial" as const, amount: 0 },
    { at: "2026-01-02", stage: "waiting" as const, amount: 0 },
    { at: "2026-01-03", stage: "paid" as const, amount: 100 },
    { at: "2026-01-04", stage: "cancelled" as const, amount: 0 },
  ];
  it("bilinmeyen değer 'tümü'dür; her süzgeç kendi aşamasını verir", () => {
    expect(parseInviteFilter("zzz")).toBe("tumu");
    expect(parseInviteFilter(null)).toBe("tumu");
    expect(filterInvites(invites, "tumu")).toHaveLength(4);
    expect(filterInvites(invites, "deneme").map((i) => i.stage)).toEqual(["trial"]);
    expect(filterInvites(invites, "bekliyor").map((i) => i.stage)).toEqual(["waiting"]);
    expect(filterInvites(invites, "odedi").map((i) => i.stage)).toEqual(["paid"]);
    expect(filterInvites(invites, "iptal").map((i) => i.stage)).toEqual(["cancelled"]);
  });
  it("bağlantılar filtreli hedefe gider", () => {
    expect(inviteFilterHref("tumu")).toBe("/app/buyume#davetler");
    expect(inviteFilterHref("odedi")).toBe("/app/buyume?durum=odedi#davetler");
  });
});

describe("pano verisi çözümleyici", () => {
  it("bozuk biçim null; sayılar güvenle çözülür; bilinmeyen aşama atlanır", () => {
    expect(parseDashboard(null)).toBeNull();
    expect(parseDashboard([])).toBeNull();
    expect(parseDashboard({ foo: 1 })).toBeNull();
    const d = parseDashboard({
      enabled: true,
      code: "abc23456",
      clicks: "7",
      signups: 3,
      trial: 1,
      waiting: 1,
      paid: 1,
      cancelled: 0,
      earned_try: 100.5,
      pending_try: 20,
      invites: [
        { at: "2026-01-01T00:00:00Z", stage: "paid", amount: 100 },
        { at: "x", stage: "bogus", amount: 1 },
      ],
      rule: { reward_type: "monthly_multiple", reward_value: 1, hold_days: 30, credit_expires_days: null },
      tiers: TIERS,
      welcome_credit_try: 0,
    });
    expect(d?.clicks).toBe(7);
    expect(d?.invites).toHaveLength(1);
    expect(d?.rule?.credit_expires_days).toBeNull();
    expect(d?.tiers.tier2_badge).toBe("Altın Elçi");
  });
});

describe("paylaşım: EmlakSoft davetçi adına ileti ATMAZ", () => {
  it("kısa bağlantı /r/<kod>; WhatsApp bağlantısı kullanıcının kendi paylaşımıdır", () => {
    expect(buildShortInviteUrl("https://x.test/", "abcd2345")).toBe("https://x.test/r/abcd2345");
    expect(buildPartnerUrl("https://x.test", "ortak-1")).toBe("https://x.test/p/ortak-1");
    const href = buildWhatsAppHref("https://x.test/r/abcd2345");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href)).toContain("https://x.test/r/abcd2345");
    expect(buildShareText("u")).toContain("u");
  });
});

describe("ölçüm: K-faktör ve oranlar", () => {
  const raw = parseAdminMetrics({
    clicks: 200,
    signups: 40,
    referrers: 20,
    payers: 10,
    claims: 12,
    flagged: 3,
    reward_cost_try: 5000,
    first_payment_revenue_try: 20000,
    status_counts: { paid: 5, held: 4 },
    due_now: 2,
    partner: { claims: 4, held: 1, approved_try: 100, paid_try: 50 },
  })!;
  it("hesaplar", () => {
    const m = computeGrowthMetrics(raw);
    expect(m.clickToSignup).toBeCloseTo(0.2);
    expect(m.signupToPaid).toBeCloseTo(0.25);
    expect(m.invitesPerReferrer).toBe(2);
    expect(m.payersPerReferrer).toBe(0.5);
    expect(m.kFactor).toBeCloseTo(0.5); // 2 davet x %25
    expect(m.costRatio).toBeCloseTo(0.25);
    expect(m.paybackMultiple).toBe(4);
    expect(m.abuseRate).toBeCloseTo(0.25);
  });
  it("sıfıra bölme uydurma sayı üretmez (null)", () => {
    const m = computeGrowthMetrics({ ...raw, clicks: 0, signups: 0, referrers: 0, payers: 0, claims: 0, reward_cost_try: 0, first_payment_revenue_try: 0 });
    expect(m.clickToSignup).toBeNull();
    expect(m.signupToPaid).toBeNull();
    expect(m.kFactor).toBeNull();
    expect(m.costRatio).toBeNull();
    expect(m.paybackMultiple).toBeNull();
    expect(m.abuseRate).toBeNull();
    expect(formatPercent(null)).toBe("-");
    expect(formatDecimal(null)).toBe("-");
    expect(formatPercent(0.255)).toBe("%25,5");
  });
  it("bozuk metrik null", () => {
    expect(parseAdminMetrics({})).toBeNull();
    expect(parseAdminMetrics(null)).toBeNull();
  });
});

describe("aktivasyon hazırlık kontrolü", () => {
  const ok: ReadinessInput = {
    tablesReady: true,
    engineReady: true,
    walletReady: true,
    referralRuleDefined: true,
    cronFresh: true,
    welcomeConfigured: true,
    partnerRuleDefined: true,
    taxPayerPartnerExists: true,
  };
  it("her şey hazırsa engelleyici yok", () => {
    for (const t of ["referral", "partner", "cash"] as const) {
      expect(readinessBlockers(evaluateReadiness(ok, t))).toEqual([]);
    }
  });
  it("migration/cüzdan/kural eksikse AÇILAMAZ; cron ve hoş geldin yalnız uyarı", () => {
    const b = readinessBlockers(evaluateReadiness({ ...ok, engineReady: false, walletReady: false, referralRuleDefined: false, cronFresh: false, welcomeConfigured: false }));
    expect(b.map((c) => c.key).sort()).toEqual(["migration", "rule", "wallet"]);
    const warnOnly = evaluateReadiness({ ...ok, cronFresh: null, welcomeConfigured: false });
    expect(readinessBlockers(warnOnly)).toEqual([]);
    expect(warnOnly.filter((c) => !c.ok).map((c) => c.key).sort()).toEqual(["cron", "welcome"]);
  });
  it("ortak ve nakit hedefleri ek şart ister", () => {
    expect(readinessBlockers(evaluateReadiness({ ...ok, partnerRuleDefined: false }, "partner")).map((c) => c.key)).toEqual(["partner_rule"]);
    expect(readinessBlockers(evaluateReadiness({ ...ok, taxPayerPartnerExists: false }, "cash")).map((c) => c.key)).toEqual(["tax_payer"]);
    expect(readinessBlockers(evaluateReadiness({ ...ok, taxPayerPartnerExists: false }, "partner"))).toEqual([]);
  });
});

describe("ortak (Faz 2) kademe ve pano", () => {
  const s = { partner_tier1_max: 4, partner_tier1_pct: 20, partner_tier2_max: 14, partner_tier2_pct: 25, partner_tier3_pct: 30 };
  it("0-4: kademe 1; 5-14: kademe 2; 15+: kademe 3", () => {
    expect(partnerTierPct(0, s)).toBe(20);
    expect(partnerTierPct(4, s)).toBe(20);
    expect(partnerTierPct(5, s)).toBe(25);
    expect(partnerTierPct(14, s)).toBe(25);
    expect(partnerTierPct(15, s)).toBe(30);
  });
  it("pano çözümleyici", () => {
    expect(parsePartnerDashboard(null)).toBeNull();
    const d = parsePartnerDashboard({ code: "ortak-1", name: "X", status: "active", program_enabled: false, cash_enabled: false, tier_pct: 20, next_tier_at: 5, payers: 2 });
    expect(d?.program_enabled).toBe(false);
    expect(d?.next_tier_at).toBe(5);
    expect(d?.pending_try).toBe(0);
  });
});

describe("bayrak etiketleri ve tetik kartları", () => {
  it("bilinmeyen bayrak olduğu gibi gösterilir", () => {
    expect(flagLabel("same_tax_no")).toBe("Aynı vergi numarası");
    expect(flagLabel("yeni_bayrak")).toBe("yeni_bayrak");
  });
  it("tetik anı kartları: sabit tutar/yüzde YOK, 5 an, depolama anahtarı ayrı", () => {
    expect(NUDGE_MOMENTS).toHaveLength(5);
    for (const m of NUDGE_MOMENTS) {
      const c = NUDGE_COPY[m];
      expect(`${c.title} ${c.text} ${c.cta}`).not.toMatch(/\d+\s*TL|%\s*\d|bedava|ücretsiz/i);
      expect(nudgeStorageKey(m)).toContain(m);
    }
    expect(NUDGE_COPY.team_grew.cta).toBe("Başka ofisleri davet et");
  });
});
