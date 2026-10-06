import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  LOW_SCORE_OWNER_HOURS,
  LOW_SCORE_TEAM_LEAD_HOURS,
  MAX_SEND_ATTEMPTS,
  applyAttemptOutcome,
  autoSendDecision,
  averageScore,
  breakdownByAgent,
  breakdownByAudienceGroup,
  breakdownByEvent,
  breakdownByEventAudience,
  combinedNpsScores,
  customerScores,
  dueAtFor,
  eventKey,
  isDueNow,
  isLowScore,
  isOverdue,
  isPromoter,
  isScheduled,
  latestRentAnniversary,
  lowScoreEscalationTarget,
  monthlyTrend,
  pickBalancedAssignee,
  pulseSummary,
  reasonDistribution,
  rentRenewalEventDate,
  resolveAssignee,
  responseRate,
  sanitizeQuestionDrafts,
  scoreStats,
  surveySmsText,
  validLowScoreNote,
  validateAnswers,
  type StatTask,
  type StoredQuestion,
} from "@/lib/surveys/logic";
import { DEFAULT_TEMPLATES } from "@/lib/surveys/defaults";
import { EVENT_AUDIENCES, SURVEY_EVENT_TYPES } from "@/lib/surveys/types";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import { featureForHref, featureForPublicPath } from "@/lib/modules/registry";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-10T12:00:00.000Z");

describe("zamanlama", () => {
  it("vade olaydan N gün sonradır", () => {
    expect(dueAtFor("2026-10-01T10:00:00.000Z", 2)).toBe("2026-10-03T10:00:00.000Z");
    expect(dueAtFor("2026-10-01T10:00:00.000Z", 0)).toBe("2026-10-01T10:00:00.000Z");
  });

  it("şimdi aranacak, zamanlanmış ve geciken ayrımı", () => {
    const due = { status: "pending", due_at: new Date(NOW - HOUR).toISOString(), next_attempt_at: null };
    const future = { status: "pending", due_at: new Date(NOW + HOUR).toISOString(), next_attempt_at: null };
    const old = { status: "pending", due_at: new Date(NOW - 50 * HOUR).toISOString(), next_attempt_at: null };
    const retried = { status: "pending", due_at: new Date(NOW - 50 * HOUR).toISOString(), next_attempt_at: new Date(NOW + HOUR).toISOString() };
    const done = { status: "completed", due_at: new Date(NOW - 99 * HOUR).toISOString(), next_attempt_at: null };
    expect(isDueNow(due, NOW)).toBe(true);
    expect(isDueNow(future, NOW)).toBe(false);
    expect(isScheduled(future, NOW)).toBe(true);
    expect(isOverdue(due, NOW, 48)).toBe(false);
    expect(isOverdue(old, NOW, 48)).toBe(true);
    // Yeniden planlanan görev planlanan zamandan sayılır, eski vadeden değil.
    expect(isOverdue(retried, NOW, 48)).toBe(false);
    expect(isDueNow(done, NOW)).toBe(false);
    expect(isOverdue(done, NOW, 1)).toBe(false);
  });
});

describe("arama sonucu ve otomatik yeniden planlama", () => {
  it("açmadı: deneme artar, N dolmadıysa yeniden planlanır", () => {
    const r = applyAttemptOutcome("no_answer", { attempts: 0, maxAttempts: 3 }, NOW, 24);
    expect(r).toMatchObject({ status: "pending", attempts: 1, lastOutcome: "no_answer" });
    expect(r.nextAttemptAt).toBe(new Date(NOW + 24 * HOUR).toISOString());
  });

  it("en çok deneme dolunca ulaşılamadı olur ve plan kalkar", () => {
    const r = applyAttemptOutcome("busy", { attempts: 2, maxAttempts: 3 }, NOW, 24);
    expect(r).toMatchObject({ status: "unreachable", attempts: 3, nextAttemptAt: null });
  });

  it("yanlış numara ulaşılamadı, ret kalıcıdır", () => {
    expect(applyAttemptOutcome("wrong_number", { attempts: 0, maxAttempts: 5 }, NOW, 24).status).toBe("unreachable");
    expect(applyAttemptOutcome("refused", { attempts: 0, maxAttempts: 5 }, NOW, 24).status).toBe("refused");
  });
});

describe("anketör atama", () => {
  it("dengeli dağıtım en az işi olanı seçer, eşitlikte kararlıdır", () => {
    const load = new Map([["b", 3], ["a", 3], ["c", 1]]);
    expect(pickBalancedAssignee(["a", "b", "c"], load)).toBe("c");
    expect(pickBalancedAssignee(["b", "a"], new Map())).toBe("a");
    expect(pickBalancedAssignee([], load)).toBeNull();
  });

  it("modlar: elle atanmamış bırakır, seçili yalnız atanmış anketörü kabul eder", () => {
    expect(resolveAssignee("manual", ["a"], null, new Map())).toBeNull();
    expect(resolveAssignee("selected", ["a", "b"], "b", new Map())).toBe("b");
    expect(resolveAssignee("selected", ["a"], "zzz", new Map())).toBeNull();
    expect(resolveAssignee("balanced", ["a", "b"], null, new Map([["a", 2]]))).toBe("b");
  });
});

describe("cevap doğrulama (telefon ve bağlı link aynı kural)", () => {
  const questions: StoredQuestion[] = [
    { id: "q1", kind: "score", label: "Puan", options: [], required: true, tag: "primary" },
    { id: "q2", kind: "choice", label: "Neden", options: ["Fiyat", "Konum"], required: false, tag: "reason" },
    { id: "q3", kind: "yesno", label: "Memnun", options: [], required: false, tag: null },
    { id: "q4", kind: "text", label: "Not", options: [], required: false, tag: null },
  ];

  it("geçerli cevaplar ana puanı ve yorumu çıkarır", () => {
    const r = validateAnswers(questions, { q1: "7", q2: "Fiyat", q3: "yes", q4: "  güzeldi  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.score).toBe(7);
      expect(r.comment).toBe("güzeldi");
      expect(r.answers).toHaveLength(4);
      expect(r.answers.find((a) => a.question_id === "q3")).toMatchObject({ value_num: 1, value_text: "Evet" });
    }
  });

  it("zorunlu soru boşsa, aralık dışı puan ve geçersiz seçenek reddedilir", () => {
    expect(validateAnswers(questions, { q2: "Fiyat" }).ok).toBe(false);
    expect(validateAnswers(questions, { q1: "11" }).ok).toBe(false);
    expect(validateAnswers(questions, { q1: "-1" }).ok).toBe(false);
    expect(validateAnswers(questions, { q1: "7.5" }).ok).toBe(false);
    expect(validateAnswers(questions, { q1: "5", q2: "Başka" }).ok).toBe(false);
    expect(validateAnswers(questions, { q1: "5", q3: "belki" }).ok).toBe(false);
  });
});

describe("tek ölçek 0-10", () => {
  it("0 geçerli puandır (NPS ölçeği), şablon metinlerinde 1-10 kalmaz", () => {
    const qs: StoredQuestion[] = [{ id: "q1", kind: "score", label: "Puan", options: [], required: true, tag: "primary" }];
    const r = validateAnswers(qs, { q1: "0" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.score).toBe(0);
    const text = JSON.stringify(DEFAULT_TEMPLATES);
    expect(text).not.toContain("1-10");
    for (const t of DEFAULT_TEMPLATES) {
      for (const q of t.questions) if (q.kind === "score") expect(q.label, `${t.event}/${t.audience}`).toContain("0-10");
    }
  });

  it("alıcı/kiracı ve satıcı/ev sahibi kapanış şablonlarında NPS + danışman puanı vardır", () => {
    for (const audience of ["buyer", "tenant", "seller", "landlord"] as const) {
      const t = DEFAULT_TEMPLATES.find((x) => x.event === "deal_won" && x.audience === audience)!;
      expect(t.questions.find((q) => q.tag === "primary")!.label).toContain("tavsiye");
      expect(t.questions.some((q) => q.tag === "advisor" && q.kind === "score")).toBe(true);
    }
  });

  it("danışman puanı etiketi yalnız puan sorusunda ve tek kalır", () => {
    const out = sanitizeQuestionDrafts([
      { kind: "score", label: "Ana", tag: "primary" },
      { kind: "score", label: "Danışman", tag: "advisor" },
      { kind: "score", label: "İkinci danışman", tag: "advisor" },
      { kind: "text", label: "Metin", tag: "advisor" },
    ]);
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out.filter((q) => q.tag === "advisor")).toHaveLength(1);
      expect(out[3]!.tag).toBeNull();
    }
  });
});

describe("NPS / CSAT", () => {
  it("bantlar 0-6 / 7-8 / 9-10; veri yoksa null", () => {
    expect(scoreStats([])).toBeNull();
    const s = scoreStats([10, 9, 8, 7, 6, 0])!;
    expect(s).toMatchObject({ n: 6, promoters: 2, passives: 2, detractors: 2, nps: 0, csat: 67 });
    expect(scoreStats([10, 10, 3])!.nps).toBe(33);
    expect(isPromoter(9)).toBe(true);
    expect(isPromoter(8)).toBe(false);
  });

  it("kitle grubu kırılımı satıcı/malik dahil; ekip nabzı müşteri NPS'ine girmez", () => {
    const tasks: StatTask[] = [
      { id: "1", event_type: "deal_won", audience: "buyer", status: "completed", score: 10, agent_id: "a", assigned_to: null },
      { id: "2", event_type: "deal_won", audience: "seller", status: "completed", score: 3, agent_id: "a", assigned_to: null },
      { id: "3", event_type: "property_unpublished", audience: "owner", status: "completed", score: 9, agent_id: "a", assigned_to: null },
      { id: "4", event_type: "advisor_pulse", audience: "advisor", status: "completed", score: 0, agent_id: null, assigned_to: null },
    ];
    expect(customerScores(tasks)).toEqual([10, 3, 9]);
    const groups = breakdownByAudienceGroup(tasks);
    expect(groups.find((g) => g.id === "satici")!.stats).toMatchObject({ n: 2, promoters: 1, detractors: 1, nps: 0 });
    expect(groups.find((g) => g.id === "alici")!.stats!.nps).toBe(100);
    expect(breakdownByEventAudience(tasks).some((r) => r.event === "advisor_pulse")).toBe(false);
  });

  it("birleşik NPS: aynı anlaşmanın alıcı cevabı (surveys yansıması) iki kez sayılmaz", () => {
    const tasks = [
      { id: "1", event_type: "deal_won", audience: "buyer", status: "completed", score: 9, agent_id: null, assigned_to: null, deal_id: "d1" },
      { id: "2", event_type: "deal_won", audience: "seller", status: "completed", score: 5, agent_id: null, assigned_to: null, deal_id: "d1" },
    ];
    const legacy = [
      { deal_id: "d1", score: 9, status: "answered" },
      { deal_id: "d2", score: 7, status: "answered" },
      { deal_id: "d3", score: null, status: "pending" },
    ];
    expect(combinedNpsScores(tasks, legacy).sort()).toEqual([5, 7, 9]);
  });

  it("aylık trend son 6 TR ayını verir; tamamlanma ayına göre", () => {
    const now = Date.parse("2026-10-07T09:00:00.000Z");
    const t = monthlyTrend(
      [
        { id: "1", event_type: "deal_won", audience: "buyer", status: "completed", score: 10, agent_id: null, assigned_to: null, completed_at: "2026-10-01T08:00:00.000Z" },
        { id: "2", event_type: "deal_won", audience: "buyer", status: "completed", score: 2, agent_id: null, assigned_to: null, completed_at: "2026-08-31T22:30:00.000Z" },
      ],
      now,
      6,
    );
    expect(t.map((p) => p.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    // 31 Ağu 22:30 UTC = 1 Eyl 01:30 TR → Eylül
    expect(t.find((p) => p.month === "2026-09")!.stats!.n).toBe(1);
    expect(t.find((p) => p.month === "2026-10")!.stats!.nps).toBe(100);
    expect(t.find((p) => p.month === "2026-08")!.stats).toBeNull();
  });
});

describe("otomatik gönderim kuralı", () => {
  const base = { status: "pending", sent_at: null, send_attempts: 0, due_at: new Date(NOW - HOUR).toISOString(), customer_id: "c1", event_type: "deal_won" };
  const ok = { nowMs: NOW, consentGranted: true, contactRecentlySent: false };
  it("vadesi gelmiş, izinli, gönderilmemiş müşteri görevine gönderir", () => {
    expect(autoSendDecision(base, ok)).toEqual({ send: true });
  });
  it("İYS izni yok, 30 gün içinde mesaj gitti, müşteri kaydı yok, deneme doldu, vade gelmedi: göndermez", () => {
    expect(autoSendDecision(base, { ...ok, consentGranted: false })).toMatchObject({ send: false, reason: "no_consent" });
    expect(autoSendDecision(base, { ...ok, contactRecentlySent: true })).toMatchObject({ send: false, reason: "cooldown" });
    expect(autoSendDecision({ ...base, customer_id: null }, ok)).toMatchObject({ send: false, reason: "no_customer" });
    expect(autoSendDecision({ ...base, send_attempts: MAX_SEND_ATTEMPTS }, ok)).toMatchObject({ send: false, reason: "attempts" });
    expect(autoSendDecision({ ...base, due_at: new Date(NOW + HOUR).toISOString() }, ok)).toMatchObject({ send: false, reason: "not_due" });
    expect(autoSendDecision({ ...base, sent_at: new Date(NOW).toISOString() }, ok)).toMatchObject({ send: false, reason: "already_sent" });
    expect(autoSendDecision({ ...base, event_type: "advisor_pulse" }, ok)).toMatchObject({ send: false, reason: "internal" });
  });
  it("SMS metni kişisel veri/işlem ayrıntısı taşımaz, bağlantıyı içerir", () => {
    const t = surveySmsText("Yıldız Emlak", "https://x.test/anket/abc");
    expect(t).toContain("https://x.test/anket/abc");
    expect(t.startsWith("Yıldız Emlak:")).toBe(true);
  });
});

describe("düşük puan zinciri", () => {
  it("24 saatte takım lideri, 48 saatte ofis sahibi; kapanmış takipte kademe yok", () => {
    const done = NOW - 10 * HOUR;
    expect(lowScoreEscalationTarget({ completedAtMs: done, handled: false, nowMs: NOW })).toBe(0);
    expect(lowScoreEscalationTarget({ completedAtMs: NOW - LOW_SCORE_TEAM_LEAD_HOURS * HOUR, handled: false, nowMs: NOW })).toBe(1);
    expect(lowScoreEscalationTarget({ completedAtMs: NOW - LOW_SCORE_OWNER_HOURS * HOUR, handled: false, nowMs: NOW })).toBe(2);
    expect(lowScoreEscalationTarget({ completedAtMs: NOW - 99 * HOUR, handled: true, nowMs: NOW })).toBe(0);
  });
  it("aksiyon notu en az 10 karakter", () => {
    expect(validLowScoreNote("arandı")).toBe(false);
    expect(validLowScoreNote("  Müşteri arandı, özür dilendi.  ")).toBe(true);
    expect(validLowScoreNote("x".repeat(2001))).toBe(false);
  });
});

describe("kira olayları", () => {
  it("yenileme olayı bitişten 60 gün önce", () => {
    expect(rentRenewalEventDate("2026-12-31")).toBe("2026-11-01");
    expect(rentRenewalEventDate(null)).toBeNull();
    expect(rentRenewalEventDate("bozuk")).toBeNull();
  });
  it("en son yıl dönümü (en az 1. yıl); 29 Şubat 28 Şubat'a düşer", () => {
    expect(latestRentAnniversary("2024-03-15", "2026-10-07")).toEqual({ year: 2, date: "2026-03-15" });
    expect(latestRentAnniversary("2025-11-01", "2026-10-07")).toBeNull();
    expect(latestRentAnniversary("2024-02-29", "2025-03-01")).toEqual({ year: 1, date: "2025-02-28" });
  });
});

describe("ekip nabzı (anonim)", () => {
  it("en az 3 cevap yoksa hiçbir sayı/yorum gösterilmez; yorumlar alfabetik", () => {
    const two = pulseSummary([{ id: "1", score: 9 }, { id: "2", score: 3 }], [], ["b", "a"]);
    expect(two).toEqual({ visible: false, n: 2 });
    const three = pulseSummary(
      [{ id: "1", score: 9 }, { id: "2", score: 3 }, { id: "3", score: 10 }],
      [{ task_id: "1", tag: "reason", value_text: "Eğitim ve koçluk" }],
      ["zeta", "Alfa"],
    );
    expect(three.visible).toBe(true);
    if (three.visible) {
      expect(three.stats.nps).toBe(33);
      expect(three.comments).toEqual(["Alfa", "zeta"]);
      expect(three.reasons).toEqual([{ reason: "Eğitim ve koçluk", count: 1 }]);
    }
  });
});

describe("şablon soru temizleme", () => {
  it("boş liste, kısa metin ve seçeneksiz seçmeli reddedilir", () => {
    expect(sanitizeQuestionDrafts([])).toHaveProperty("error");
    expect(sanitizeQuestionDrafts([{ kind: "text", label: "a" }])).toHaveProperty("error");
    expect(sanitizeQuestionDrafts([{ kind: "choice", label: "Seçim", options: ["tek"] }])).toHaveProperty("error");
  });

  it("tek ana puan kalır, ilk puan sorusu varsayılan ana puandır", () => {
    const out = sanitizeQuestionDrafts([
      { kind: "score", label: "Birinci", tag: "primary" },
      { kind: "score", label: "İkinci", tag: "primary" },
      { kind: "choice", label: "Neden", options: ["a", "b", "a"], tag: "reason" },
    ]);
    expect(Array.isArray(out)).toBe(true);
    if (Array.isArray(out)) {
      expect(out.filter((q) => q.tag === "primary")).toHaveLength(1);
      expect(out[2]!.options).toEqual(["a", "b"]);
    }
    const def = sanitizeQuestionDrafts([{ kind: "score", label: "Puan" }]);
    if (Array.isArray(def)) expect(def[0]!.tag).toBe("primary");
  });
});

describe("sonuç hesapları", () => {
  const tasks: StatTask[] = [
    { id: "1", event_type: "deal_won", status: "completed", score: 9, agent_id: "a", assigned_to: "s" },
    { id: "2", event_type: "deal_won", status: "completed", score: 5, agent_id: "a", assigned_to: "s" },
    { id: "3", event_type: "deal_lost", status: "unreachable", score: null, agent_id: "b", assigned_to: "s" },
    { id: "4", event_type: "deal_lost", status: "pending", score: null, agent_id: null, assigned_to: null },
    { id: "5", event_type: "deal_lost", status: "refused", score: null, agent_id: "b", assigned_to: "s" },
  ];

  it("cevaplama oranı kapanan görevler içindedir; veri yoksa null", () => {
    expect(responseRate(tasks)).toBe(50); // 2 tamamlandı / 4 kapanan
    expect(responseRate([tasks[3]!])).toBeNull();
    expect(averageScore(tasks)).toBe(7);
    expect(averageScore([])).toBeNull();
  });

  it("olay ve danışman kırılımı", () => {
    const ev = breakdownByEvent(tasks);
    expect(ev).toHaveLength(SURVEY_EVENT_TYPES.length);
    expect(ev.find((e) => e.event === "deal_won")).toMatchObject({ total: 2, completed: 2, avg: 7 });
    expect(ev.find((e) => e.event === "deal_lost")).toMatchObject({ total: 3, pending: 1, closed: 2 });
    const ag = breakdownByAgent(tasks);
    expect(ag[0]).toMatchObject({ agentId: "a", completed: 2, avg: 7 });
    expect(ag.some((a) => a.agentId === null)).toBe(true);
  });

  it("neden dağılımı yalnız neden etiketli cevapları sayar", () => {
    const out = reasonDistribution([
      { task_id: "1", tag: "reason", value_text: "Fiyat" },
      { task_id: "2", tag: "reason", value_text: "Fiyat" },
      { task_id: "3", tag: "reason", value_text: "Konum" },
      { task_id: "3", tag: null, value_text: "Not" },
    ]);
    expect(out).toEqual([{ reason: "Fiyat", count: 2 }, { reason: "Konum", count: 1 }]);
    expect(reasonDistribution([{ task_id: "9", tag: "reason", value_text: "Fiyat" }], new Set(["1"]))).toEqual([]);
  });

  it("düşük puan sınırı ve olay anahtarı", () => {
    expect(isLowScore(6, 6)).toBe(true);
    expect(isLowScore(7, 6)).toBe(false);
    expect(isLowScore(null, 6)).toBe(false);
    expect(eventKey("deal_won", "d1", "buyer")).toBe("deal_won:d1:buyer");
    expect(eventKey("authority_extended", "p1", "owner", "2026-12-01")).toBe("authority_extended:p1:owner:2026-12-01");
  });
});

describe("hazır şablonlar", () => {
  it("her olay x muhatap çiftinin Türkçe şablonu vardır ve ana puan sorusu içerir", () => {
    for (const event of SURVEY_EVENT_TYPES) {
      for (const audience of EVENT_AUDIENCES[event]) {
        const t = DEFAULT_TEMPLATES.find((x) => x.event === event && x.audience === audience);
        expect(t, `${event}/${audience}`).toBeDefined();
        expect(t!.questions.some((q) => q.tag === "primary" && q.kind === "score")).toBe(true);
        for (const q of t!.questions) if (q.kind === "choice") expect(q.options.length).toBeGreaterThanOrEqual(2);
      }
    }
    expect(DEFAULT_TEMPLATES).toHaveLength(SURVEY_EVENT_TYPES.reduce((n, e) => n + EVENT_AUDIENCES[e].length, 0));
  });

  it("şablon metinleri sahte skor veya boş vaat içermez; 'lead' kelimesi yok", () => {
    const text = JSON.stringify(DEFAULT_TEMPLATES).toLowerCase();
    expect(text).not.toContain("lead");
  });
});

describe("modül kaydı", () => {
  it("surveys modülü yetki matrisinde ve ürün kayıt defterinde vardır", () => {
    expect(DEFAULT_MATRIX.owner.surveys).toEqual(["view", "create", "edit", "delete"]);
    expect(DEFAULT_MATRIX.advisor.surveys).toEqual(["view"]);
    expect(DEFAULT_MATRIX.readonly.surveys).toEqual(["view"]);
    expect(featureForHref("/app/anketler/kuyruk?durum=bekleyen")).toBe("surveys");
    expect(featureForPublicPath("/anket/abc")).toBeNull();
  });

  it("migration (2026-10-05 terfi) ve rollback dosyası aynı numarayla vardır; eski taslak kopyası kalmamıştır", () => {
    const dir = path.join(process.cwd(), "supabase");
    const sql = path.join(dir, "migrations", "20260825000700_survey_module.sql");
    expect(existsSync(sql)).toBe(true);
    expect(existsSync(path.join(dir, "rollbacks", "20260825000700_survey_module.rollback.sql"))).toBe(true);
    expect(existsSync(path.join(dir, "proposed", "20260820010000_survey_module.sql"))).toBe(false);
    expect(existsSync(path.join(dir, "migrations", "20260820010000_survey_module.sql"))).toBe(false);
    const body = readFileSync(sql, "utf8");
    for (const table of ["survey_tasks", "survey_templates", "survey_questions", "survey_answers", "survey_assignees", "survey_triggers", "survey_settings", "survey_attempts"]) {
      expect(body).toContain(`create table if not exists public.${table}`);
    }
    expect(body).toContain("unique (tenant_id, event_key)");
    expect(body).toContain("enable row level security");
  });
});
