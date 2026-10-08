import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BADGES,
  SCORE_RULES,
  SCORE_RULE_HINTS,
  SCORE_RULE_KEYS,
  SCORE_RULE_LABELS,
  computeAgentScores,
  emptyAgentStats,
  evaluateBadges,
  type ActivityRow,
  type ScoreRuleset,
} from "@/lib/gamification";
import {
  currentLeaguePeriod,
  isWeekKey,
  leaguePeriod,
  nextLeaguePeriod,
  previousLeaguePeriod,
  shiftWeekKey,
  weekKeyOf,
} from "@/lib/league/periods";
import { DEFAULT_LEAGUE_SETTINGS, MAX_RULE_POINTS, resolveLeagueSettings, rulesToStore } from "@/lib/league/settings";
import {
  buildChallengeResult,
  challengeCounts,
  challengeFinishMessage,
  challengeProgress,
  challengeState,
  remainingLabel,
  type ChallengeDef,
} from "@/lib/league/challenge";
import { buildCoachPlan, lowActivityAdvisors, type CoachFacts } from "@/lib/league/coach";
import { evidenceHref } from "@/lib/league/evidence";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

const row = (staffId: string, kind: ActivityRow["kind"], over: Partial<ActivityRow> = {}): ActivityRow => ({
  staffId,
  kind,
  at: "2026-10-06T10:00:00.000Z",
  ...over,
});

describe("lig dönemleri (TR saati)", () => {
  it("hafta Pazartesi 00:00 TR başlar: UTC Pazar 21:00", () => {
    const monday = Date.parse("2026-10-04T21:00:00.000Z"); // 5 Ekim Pazartesi 00:00 TR
    expect(weekKeyOf(monday)).toBe("2026-W41");
    expect(weekKeyOf(monday - 1)).toBe("2026-W40");
    const p = leaguePeriod("2026-W41", 0);
    expect(p.kind).toBe("week");
    expect(p.startIso).toBe("2026-10-04T21:00:00.000Z");
    expect(p.endIso).toBe("2026-10-11T21:00:00.000Z");
  });

  it("ay sınırı TR gece yarısı (önceki ayın 21:00 UTC'si)", () => {
    const p = leaguePeriod("2026-10", 0);
    expect(p.kind).toBe("month");
    expect(p.startIso).toBe("2026-09-30T21:00:00.000Z");
    expect(p.endIso).toBe("2026-10-31T21:00:00.000Z");
  });

  it("yıl dönümü ve 53 haftalı yıl doğru kayar", () => {
    expect(shiftWeekKey("2026-W01", -1)).toBe("2025-W52");
    expect(shiftWeekKey("2027-W01", -1)).toBe("2026-W53");
    expect(shiftWeekKey("2026-W53", 1)).toBe("2027-W01");
    expect(previousLeaguePeriod("2026-01", 0)).toBe("2025-12");
    expect(nextLeaguePeriod("2026-12", 0)).toBe("2027-01");
    expect(previousLeaguePeriod("2026-W41", 0)).toBe("2026-W40");
  });

  it("geçersiz anahtar ay aralığına düşer; hafta anahtarı tanınır", () => {
    expect(isWeekKey("2026-W41")).toBe(true);
    expect(isWeekKey("2026-10")).toBe(false);
    const fallback = Date.parse("2026-10-08T12:00:00.000Z");
    expect(leaguePeriod("saçma", fallback).period).toBe("2026-10");
    expect(leaguePeriod("2026-W99", fallback).kind).toBe("month");
    expect(currentLeaguePeriod("week", fallback)).toBe("2026-W41");
    expect(currentLeaguePeriod("month", fallback)).toBe("2026-10");
  });
});

describe("puan hesabı: hile koruması", () => {
  it("örnek (demo) veri sayılmaz; ofis açıkça dahil ederse sayılır", () => {
    const rows = [row(A, "deal_won", { ref: "d1", isSample: true }), row(A, "deal_won", { ref: "d2" })];
    expect(computeAgentScores(rows)[0].total).toBe(SCORE_RULES.deal_won);
    expect(computeAgentScores(rows, SCORE_RULES, { includeSample: true })[0].total).toBe(SCORE_RULES.deal_won * 2);
  });

  it("aynı kaydın (kind+kişi+ref) tekrarı tek sayılır", () => {
    const rows = [row(A, "customer_new", { ref: "c1" }), row(A, "customer_new", { ref: "c1" }), row(A, "customer_new", { ref: "c2" })];
    const [a] = computeAgentScores(rows);
    expect(a.breakdown.customer_new.count).toBe(2);
    expect(a.total).toBe(SCORE_RULES.customer_new * 2);
  });

  it("aynı kayıt farklı kural türünde ayrı puandır (portföy + yetkili bonus)", () => {
    const rows = [row(A, "property_new", { ref: "p1" }), row(A, "listing_authorized", { ref: "p1" })];
    expect(computeAgentScores(rows)[0].total).toBe(SCORE_RULES.property_new + SCORE_RULES.listing_authorized);
  });

  it("ref'siz satırlar eski davranışla sayılır (geri uyum)", () => {
    expect(computeAgentScores([row(A, "task_done"), row(A, "task_done")])[0].breakdown.task_done.count).toBe(2);
  });

  it("puanı 0 olan kural kapalıdır: ne puan ne adet", () => {
    const off: ScoreRuleset = { ...SCORE_RULES, task_done: 0 };
    const scores = computeAgentScores([row(A, "task_done", { ref: "t" }), row(A, "deal_won", { ref: "d" })], off);
    expect(scores[0].breakdown.task_done.count).toBe(0);
    expect(scores[0].total).toBe(SCORE_RULES.deal_won);
  });

  it("silinen/geri alınan kayıt satırdan düşer, puan düşer (canlı hesap)", () => {
    const before = computeAgentScores([row(A, "deal_won", { ref: "d1" }), row(A, "deal_won", { ref: "d2" })])[0].total;
    const after = computeAgentScores([row(A, "deal_won", { ref: "d1" })])[0].total;
    expect(after).toBe(before - SCORE_RULES.deal_won);
  });

  it("her kural anahtarının etiketi, ipucu ve kanıt bağlantısı vardır", () => {
    for (const k of SCORE_RULE_KEYS) {
      expect(SCORE_RULE_LABELS[k]).toBeTruthy();
      expect(SCORE_RULE_HINTS[k]).toBeTruthy();
      expect(SCORE_RULES[k]).toBeGreaterThan(0);
      expect(evidenceHref(k, A)).toMatch(/^\/app\//);
    }
  });
});

describe("ofis ayarı", () => {
  it("ayar yokken / bozukken varsayılan, tutar gösterimi KAPALI", () => {
    expect(DEFAULT_LEAGUE_SETTINGS.showAmounts).toBe(false);
    expect(resolveLeagueSettings(null)).toEqual(DEFAULT_LEAGUE_SETTINGS);
    expect(resolveLeagueSettings({ rules: "bozuk", show_amounts: "evet" }).showAmounts).toBe(false);
    expect(resolveLeagueSettings({ rules: [1, 2] }).customized).toBe(false);
  });

  it("özel puan uygulanır, sınırlanır, geçersiz değer varsayılana düşer", () => {
    const s = resolveLeagueSettings({ rules: { deal_won: 250, task_done: 0, offer_made: 99999, customer_new: "abc" }, show_amounts: true });
    expect(s.ruleset.deal_won).toBe(250);
    expect(s.ruleset.task_done).toBe(0);
    expect(s.ruleset.offer_made).toBe(MAX_RULE_POINTS);
    expect(s.ruleset.customer_new).toBe(SCORE_RULES.customer_new);
    expect(s.customized).toBe(true);
    expect(s.showAmounts).toBe(true);
  });

  it("yalnız varsayılandan farklı kurallar saklanır", () => {
    expect(rulesToStore({ deal_won: "100", task_done: "7", x: "1", offer_made: "-5" })).toEqual({ task_done: 7, offer_made: 0 });
  });
});

describe("yeni rozetler", () => {
  it("Gösterim Ustası: dönemde 10 gösterim", () => {
    expect(evaluateBadges(emptyAgentStats({ showingCount: 9 }))).not.toContain("gosterim_10");
    expect(evaluateBadges(emptyAgentStats({ showingCount: 10 }))).toContain("gosterim_10");
  });
  it("Yetki Avcısı: dönemde 3 tek yetkili portföy", () => {
    expect(evaluateBadges(emptyAgentStats({ authorizedCount: 2 }))).not.toContain("yetki_avcisi");
    expect(evaluateBadges(emptyAgentStats({ authorizedCount: 3 }))).toContain("yetki_avcisi");
  });
  it("Beş Gün Seri: 5 gün üst üste aktivite (4'te yok)", () => {
    expect(evaluateBadges(emptyAgentStats({ streakDays: 4 }))).not.toContain("seri_5");
    expect(evaluateBadges(emptyAgentStats({ streakDays: 5 }))).toContain("seri_5");
  });
  it("Hız Ustası ölçüm yokken (null) verilmez; ilk anlaşma kalıcıdır", () => {
    expect(evaluateBadges(emptyAgentStats())).not.toContain("hiz_ustasi");
    expect(evaluateBadges(emptyAgentStats({ avgFirstResponseMin: 10 }))).toContain("hiz_ustasi");
    expect(BADGES.find((b) => b.code === "ilk_anlasma")?.scope).toBe("lifetime");
  });
  it("rozet kodları benzersiz", () => {
    expect(new Set(BADGES.map((b) => b.code)).size).toBe(BADGES.length);
  });
});

describe("meydan okuma", () => {
  const def = (over: Partial<ChallengeDef> = {}): ChallengeDef => ({
    id: "c1",
    title: "Bu ay 4 yetkili portföy",
    description: null,
    rewardText: "Ekip yemeği",
    metric: "listing_authorized",
    scope: "team",
    targetValue: 4,
    startsAtIso: "2026-10-01T00:00:00.000Z",
    endsAtIso: "2026-10-31T00:00:00.000Z",
    status: "active",
    ...over,
  });
  const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`;

  it("zaman durumu ve kalan süre", () => {
    const d = def();
    expect(challengeState(d, Date.parse("2026-09-30T00:00:00.000Z"))).toBe("upcoming");
    expect(challengeState(d, Date.parse("2026-10-10T00:00:00.000Z"))).toBe("live");
    expect(challengeState(d, Date.parse("2026-10-31T00:00:00.000Z"))).toBe("ended");
    expect(remainingLabel(0)).toBe("süre doldu");
    expect(remainingLabel(3 * 86_400_000 + 5)).toBe("3 gün kaldı");
  });

  it("yalnız ölçüte, aralığa uyan, tekil, örnek olmayan kayıtlar sayılır", () => {
    const rows: ActivityRow[] = [
      row(A, "listing_authorized", { ref: "p1", at: at(2) }),
      row(A, "listing_authorized", { ref: "p1", at: at(2) }), // tekrar
      row(A, "listing_authorized", { ref: "p2", at: at(3), isSample: true }), // örnek
      row(A, "listing_authorized", { ref: "p3", at: "2026-09-30T23:59:59.000Z" }), // aralık dışı
      row(A, "listing_authorized", { ref: "p4", at: "2026-10-31T00:00:00.000Z" }), // bitiş HARİÇ
      row(B, "listing_authorized", { ref: "p5", at: at(4) }),
      row(B, "property_new", { ref: "p5", at: at(4) }), // başka ölçüt
    ];
    const counts = challengeCounts(def(), rows);
    expect(counts.get(A)).toBe(1);
    expect(counts.get(B)).toBe(1);
  });

  it("kural puanı 0 olsa da meydan okuma adedi sayar", () => {
    const counts = challengeCounts(def({ metric: "task_done" }), [row(A, "task_done", { ref: "t1", at: at(5) })]);
    expect(counts.get(A)).toBe(1);
  });

  it("ekip hedefi toplamdır; hedefi aşınca %100'de durur ve herkes kazanan", () => {
    const p = challengeProgress(def(), new Map([[A, 3], [B, 2]]));
    expect(p.current).toBe(5);
    expect(p.pct).toBe(100);
    expect(p.reached).toBe(true);
    expect(p.winners.map((w) => w.staffId)).toEqual([A, B]);
    const half = challengeProgress(def(), new Map([[A, 1], [B, 1]]));
    expect(half.pct).toBe(50);
    expect(half.reached).toBe(false);
    expect(half.winners).toEqual([]);
  });

  it("bireysel yarışta lider adedi ilerlemedir; hedefe ulaşanlar kazanır; eşitlik aynı sıra", () => {
    const p = challengeProgress(def({ scope: "individual" }), new Map([[A, 4], [B, 4], [C, 1]]));
    expect(p.current).toBe(4);
    expect(p.reached).toBe(true);
    expect(p.entries.map((e) => e.rank)).toEqual([1, 1, 3]);
    expect(p.winners.map((w) => w.staffId)).toEqual([A, B]);
    expect(challengeProgress(def({ scope: "individual" }), new Map([[C, 1]])).reached).toBe(false);
  });

  it("sonuç mühürü ve kutlama metni tutar içermez", () => {
    const d = def({ scope: "individual" });
    const result = buildChallengeResult(d, challengeProgress(d, new Map([[A, 5]])));
    const msg = challengeFinishMessage(d, result, (id) => (id === A ? "Ayşe Yılmaz" : "?"));
    expect(msg.title).toContain("kazananı");
    expect(msg.body).toContain("Ayşe Yılmaz (5)");
    expect(msg.body).toContain("Ekip yemeği");
    const text = JSON.stringify(result) + msg.title + msg.body;
    expect(text).not.toMatch(/revenue|amount|commission|₺|TL\b/i);
    const miss = challengeFinishMessage(def(), buildChallengeResult(def(), challengeProgress(def(), new Map([[A, 1]]))), () => "x");
    expect(miss.body).toContain("1/4");
  });
});

describe("kişisel koçluk", () => {
  const facts = (over: Partial<CoachFacts> = {}): CoachFacts => ({
    ruleset: SCORE_RULES,
    myRank: 3,
    myTotal: 40,
    leaderTotal: 100,
    runnerUpTotal: 70,
    overdueTasks: [],
    waitingLeads: [],
    unconfirmedListings: [],
    pastAppointments: [],
    ...over,
  });
  const item = (id: string, label = id) => ({ id, label, href: `/app/gorevler?x=${id}` });

  it("liderliğe kalan puanı söyler; liderse farkı", () => {
    expect(buildCoachPlan(facts()).headline).toBe("Bu hafta liderliğe 60 puan var.");
    expect(buildCoachPlan(facts()).gapPoints).toBe(60);
    const lead = buildCoachPlan(facts({ myRank: 1, myTotal: 100, leaderTotal: 100 }));
    expect(lead.isLeader).toBe(true);
    expect(lead.headline).toContain("fark 30 puan");
    expect(buildCoachPlan(facts({ myRank: null, myTotal: 0 })).headline).toContain("puanın yok");
  });

  it("bekleyen kayıt yoksa eylem yok (boş vaat yok)", () => {
    expect(buildCoachPlan(facts()).actions).toEqual([]);
  });

  it("en çok 3 eylem, potansiyel puana göre; her eylem href + kanıt taşır", () => {
    const plan = buildCoachPlan(
      facts({
        overdueTasks: [item("t1"), item("t2")],
        waitingLeads: [{ ...item("l1"), withinSla: true }],
        unconfirmedListings: [item("i1"), item("i2"), item("i3")],
        pastAppointments: [
          { ...item("a1"), isShowing: true },
          { ...item("a2"), isShowing: false },
        ],
      }),
    );
    expect(plan.actions).toHaveLength(3);
    // showing 15, fast 8, appointment 10, tasks 5x2=10, confirm 3x3=9 -> 15, 10 (appt/task, anahtar sırası), 10
    expect(plan.actions[0].rule).toBe("showing_done");
    for (const a of plan.actions) {
      expect(a.href).toMatch(/^\/app\//);
      expect(a.evidence.length).toBeGreaterThan(0);
      expect(a.evidence.length).toBeLessThanOrEqual(3);
      expect(a.potential).toBe(a.pointsEach * Math.min(a.count, 5));
    }
  });

  it("SLA'sı geçmiş talep puan vaat etmez; kapalı kural önerilmez", () => {
    const late = buildCoachPlan(facts({ waitingLeads: [{ ...item("l1"), withinSla: false }] }));
    expect(late.actions).toEqual([]);
    const off = buildCoachPlan(facts({ ruleset: { ...SCORE_RULES, task_done: 0 }, overdueTasks: [item("t1")] }));
    expect(off.actions).toEqual([]);
  });
});

describe("düşük aktivite uyarısı", () => {
  const mk = (id: string, total: number) => ({ staffId: id, name: id, total, activityCount: total / 10 });

  it("erken dönemde veya az kişide uyarı yok", () => {
    const rows = [mk("a", 100), mk("b", 120), mk("c", 5)];
    expect(lowActivityAdvisors(rows, 0.1)).toEqual([]);
    expect(lowActivityAdvisors(rows.slice(0, 2), 0.8)).toEqual([]);
  });

  it("medyanın %40'ının altındaki kanıtlı olarak işaretlenir", () => {
    const f = lowActivityAdvisors([mk("a", 100), mk("b", 120), mk("c", 5), mk("d", 90)], 0.5);
    expect(f.map((x) => x.staffId)).toEqual(["c"]);
    expect(f[0].evidence).toContain("5 puan");
    expect(f[0].evidence).toContain("medyanı 95");
    expect(f[0].href).toBe("/app/ekip/c");
  });

  it("ofis medyanı anlamsızsa (hepsi düşük) kimse etiketlenmez", () => {
    expect(lowActivityAdvisors([mk("a", 0), mk("b", 10), mk("c", 5)], 0.9)).toEqual([]);
  });
});

describe("P12: ligde tutar sızmaz", () => {
  const root = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");
  const MONEY = /\b(revenue|commission|commissions|deal_value|deal_amount|estimated_lost_commission|list_price|target_revenue|gross_collected)\b/i;

  it("lig lib dosyaları ve puan/sorgu katmanı tutar kolonu/alanı içermez", () => {
    const dir = join(root, "lib", "league");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(read(`lib/league/${f}`), f).not.toMatch(MONEY);
    expect(read("lib/gamification.ts")).not.toMatch(MONEY);
    expect(read("lib/gamification-query.ts")).not.toMatch(MONEY);
  });

  it("lig bileşenleri ve koç/özet kartları tutar içermez", () => {
    for (const p of [
      "app/app/lig/challenges-panel.tsx",
      "app/app/lig/challenge-form.tsx",
      "app/app/performansim/lig-kocu.tsx",
      "app/app/ekip/kiyas/lig-ozeti.tsx",
      "app/actions/league.ts",
    ]) {
      expect(read(p), p).not.toMatch(MONEY);
    }
  });

  it("lig sayfası tutar sorgusunu yalnız yönetici ayarı açıkken yapar (varsayılan kapalı)", () => {
    const page = read("app/app/lig/page.tsx");
    const gate = page.indexOf("const showAmounts = settings.showAmounts");
    expect(gate).toBeGreaterThan(-1);
    const call = page.indexOf("await loadAdvisorMetrics(");
    expect(call).toBeGreaterThan(gate);
    expect(page.slice(gate, call)).toContain("if (showAmounts)");
    // Para biçimleyici yalnız tutar sütunu bloğunda (showAmounts) kullanılır.
    const fmt = page.indexOf('style: "currency"');
    expect(fmt).toBeGreaterThan(call);
    expect(DEFAULT_LEAGUE_SETTINGS.showAmounts).toBe(false);
  });

  it("TV lig tablosu ve bildirim metinleri tutar içermez", () => {
    const daily = read("lib/league/daily.ts");
    expect(daily).not.toMatch(MONEY);
    const deals = read("app/actions/deals.ts");
    const i = deals.indexOf("Kutlama (Lig 2.0)");
    expect(i).toBeGreaterThan(-1);
    expect(deals.slice(i, i + 900)).not.toMatch(/deal_value|dealValue|komisyon kontrol/i);
  });
});
