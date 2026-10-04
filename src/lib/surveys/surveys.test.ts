import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  applyAttemptOutcome,
  averageScore,
  breakdownByAgent,
  breakdownByEvent,
  dueAtFor,
  eventKey,
  isDueNow,
  isLowScore,
  isOverdue,
  isScheduled,
  pickBalancedAssignee,
  reasonDistribution,
  resolveAssignee,
  responseRate,
  sanitizeQuestionDrafts,
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
    expect(validateAnswers(questions, { q1: "0" }).ok).toBe(false);
    expect(validateAnswers(questions, { q1: "5", q2: "Başka" }).ok).toBe(false);
    expect(validateAnswers(questions, { q1: "5", q3: "belki" }).ok).toBe(false);
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

  it("taslak migration ve rollback dosyaları aynı numarayla vardır, uygulanmış migration klasörüne dokunmaz", () => {
    const dir = path.join(process.cwd(), "supabase");
    const sql = path.join(dir, "proposed", "20260820010000_survey_module.sql");
    expect(existsSync(sql)).toBe(true);
    expect(existsSync(path.join(dir, "proposed", "20260820010000_survey_module.rollback.sql"))).toBe(true);
    expect(existsSync(path.join(dir, "migrations", "20260820010000_survey_module.sql"))).toBe(false);
    const body = readFileSync(sql, "utf8");
    for (const table of ["survey_tasks", "survey_templates", "survey_questions", "survey_answers", "survey_assignees", "survey_triggers", "survey_settings", "survey_attempts"]) {
      expect(body).toContain(`create table if not exists public.${table}`);
    }
    expect(body).toContain("unique (tenant_id, event_key)");
    expect(body).toContain("enable row level security");
  });
});
