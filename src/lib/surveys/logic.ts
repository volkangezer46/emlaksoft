import {
  EVENT_AUDIENCES,
  SURVEY_EVENT_TYPES,
  type SurveyEventType,
  type SurveyOutcome,
  type SurveyQuestionDef,
  type SurveyQuestionKind,
  type SurveyTaskStatus,
} from "@/lib/surveys/types";

/**
 * Anket modülünün saf iş kuralları (veritabanı ve saat bağımsız; birim testli).
 * Zamanlar parametre olarak gelir (`nowMs`), bu dosyada saat okunmaz.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/* --------------------------------------------------------------- zamanlama */

/** Olaydan `delayDays` gün sonra anket görevi vadesi gelir. */
export function dueAtFor(eventAtIso: string, delayDays: number): string {
  const base = Date.parse(eventAtIso);
  const safe = Number.isFinite(base) ? base : 0;
  return new Date(safe + Math.max(0, delayDays) * DAY_MS).toISOString();
}

export type QueueTimes = { status: string; due_at: string; next_attempt_at: string | null };

/** Görevin sıradaki arama zamanı: yeniden deneme planlıysa o, değilse vade. */
export function effectiveDueMs(t: QueueTimes): number {
  return Date.parse(t.next_attempt_at ?? t.due_at);
}

/** Kuyrukta şimdi aranabilir mi? (bekliyor ve zamanı gelmiş) */
export function isDueNow(t: QueueTimes, nowMs: number): boolean {
  return t.status === "pending" && effectiveDueMs(t) <= nowMs;
}

/** Geciken: arama zamanı geldi ve eşik saati aştı, hâlâ bekliyor. */
export function isOverdue(t: QueueTimes, nowMs: number, overdueHours: number): boolean {
  return t.status === "pending" && effectiveDueMs(t) + overdueHours * HOUR_MS <= nowMs;
}

/** Zamanlanmış: vadesi henüz gelmemiş bekleyen görev. */
export function isScheduled(t: QueueTimes, nowMs: number): boolean {
  return t.status === "pending" && effectiveDueMs(t) > nowMs;
}

export type AttemptResult = {
  status: SurveyTaskStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastOutcome: SurveyOutcome;
};

/**
 * Arama sonucunun görev durumuna etkisi.
 * Açmadı/meşgul: deneme sayısı artar; en çok deneme dolunca "ulaşılamadı", dolmadıysa `retryHours` sonrasına
 * otomatik yeniden planlanır. Yanlış numara ulaşılamadı sayılır, ret kalıcıdır.
 */
export function applyAttemptOutcome(
  outcome: Exclude<SurveyOutcome, "completed" | "reassigned">,
  current: { attempts: number; maxAttempts: number },
  nowMs: number,
  retryHours: number,
): AttemptResult {
  const attempts = current.attempts + 1;
  if (outcome === "refused") return { status: "refused", attempts, nextAttemptAt: null, lastOutcome: outcome };
  if (outcome === "wrong_number") return { status: "unreachable", attempts, nextAttemptAt: null, lastOutcome: outcome };
  if (attempts >= Math.max(1, current.maxAttempts)) {
    return { status: "unreachable", attempts, nextAttemptAt: null, lastOutcome: outcome };
  }
  return {
    status: "pending",
    attempts,
    nextAttemptAt: new Date(nowMs + Math.max(1, retryHours) * HOUR_MS).toISOString(),
    lastOutcome: outcome,
  };
}

/* ------------------------------------------------------------------ atama */

/**
 * Dengeli dağıtım: açık görev sayısı en az olan anketöre verir; eşitlikte kimlik sırası (kararlı).
 * Verilen `load` haritasını güncellemez; çağıran her atamadan sonra kendi sayacını artırır.
 */
export function pickBalancedAssignee(assigneeIds: readonly string[], load: ReadonlyMap<string, number>): string | null {
  if (assigneeIds.length === 0) return null;
  const sorted = [...assigneeIds].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b));
  return sorted[0] ?? null;
}

export function resolveAssignee(
  mode: "balanced" | "selected" | "manual",
  assigneeIds: readonly string[],
  fixed: string | null,
  load: ReadonlyMap<string, number>,
): string | null {
  if (mode === "manual") return null;
  if (mode === "selected") return fixed && assigneeIds.includes(fixed) ? fixed : null;
  return pickBalancedAssignee(assigneeIds, load);
}

/* --------------------------------------------------------- soru doğrulama */

const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 12;

export type QuestionDraftError = { error: string };

/** Şablon kaydında gelen soru taslaklarını temizler ve doğrular. */
export function sanitizeQuestionDrafts(raw: unknown): SurveyQuestionDef[] | QuestionDraftError {
  if (!Array.isArray(raw)) return { error: "Soru listesi geçersiz." };
  if (raw.length === 0) return { error: "Şablonda en az bir soru olmalı." };
  if (raw.length > MAX_QUESTIONS) return { error: `Bir şablonda en çok ${MAX_QUESTIONS} soru olabilir.` };
  const out: SurveyQuestionDef[] = [];
  let primaryCount = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "Soru biçimi geçersiz." };
    const q = item as Record<string, unknown>;
    const kind = q.kind as SurveyQuestionKind;
    if (kind !== "score" && kind !== "choice" && kind !== "yesno" && kind !== "text") return { error: "Soru türü geçersiz." };
    const label = String(q.label ?? "").trim().slice(0, 300);
    if (label.length < 2) return { error: "Her sorunun metni en az 2 karakter olmalı." };
    let options: string[] = [];
    if (kind === "choice") {
      options = (Array.isArray(q.options) ? q.options : [])
        .map((o) => String(o ?? "").trim().slice(0, 120))
        .filter(Boolean);
      options = [...new Set(options)].slice(0, MAX_OPTIONS);
      if (options.length < 2) return { error: `"${label}" sorusu için en az 2 seçenek girin.` };
    }
    let tag: SurveyQuestionDef["tag"] = q.tag === "primary" || q.tag === "reason" ? q.tag : null;
    if (tag === "primary" && kind !== "score") tag = null;
    if (tag === "reason" && kind !== "choice") tag = null;
    if (tag === "primary") {
      primaryCount += 1;
      if (primaryCount > 1) tag = null; // yalnız ilk puan sorusu ana puandır
    }
    const id = typeof q.id === "string" && q.id ? q.id : undefined;
    out.push({ id, kind, label, options, required: q.required === true, tag });
  }
  // Ana puan atanmadıysa ilk puan sorusu ana puan olur.
  if (primaryCount === 0) {
    const first = out.find((q) => q.kind === "score");
    if (first) first.tag = "primary";
  }
  return out;
}

export type StoredQuestion = {
  id: string;
  kind: SurveyQuestionKind;
  label: string;
  options: string[];
  required: boolean;
  tag: string | null;
};

export type ValidAnswer = {
  question_id: string;
  question_label: string;
  tag: string | null;
  value_num: number | null;
  value_text: string | null;
};

export type AnswerCheck = { ok: true; answers: ValidAnswer[]; score: number | null; comment: string | null } | { ok: false; error: string };

/**
 * Cevapları şablon sorularına göre doğrular (telefonla ve bağlı link AYNI kuralı kullanır).
 * `raw`: soru kimliği -> ham metin. Boş ve zorunlu olmayan cevap atlanır.
 */
export function validateAnswers(questions: readonly StoredQuestion[], raw: Record<string, unknown>): AnswerCheck {
  const answers: ValidAnswer[] = [];
  let score: number | null = null;
  let comment: string | null = null;
  for (const q of questions) {
    const value = String(raw[q.id] ?? "").trim();
    if (!value) {
      if (q.required) return { ok: false, error: `"${q.label}" sorusu zorunlu.` };
      continue;
    }
    if (q.kind === "score") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 10) return { ok: false, error: "Puan 1 ile 10 arasında olmalı." };
      answers.push({ question_id: q.id, question_label: q.label, tag: q.tag, value_num: n, value_text: null });
      if (q.tag === "primary" && score === null) score = n;
    } else if (q.kind === "yesno") {
      if (value !== "yes" && value !== "no") return { ok: false, error: `"${q.label}" için Evet veya Hayır seçin.` };
      answers.push({ question_id: q.id, question_label: q.label, tag: q.tag, value_num: value === "yes" ? 1 : 0, value_text: value === "yes" ? "Evet" : "Hayır" });
    } else if (q.kind === "choice") {
      if (!q.options.includes(value)) return { ok: false, error: `"${q.label}" için geçerli bir seçenek seçin.` };
      answers.push({ question_id: q.id, question_label: q.label, tag: q.tag, value_num: null, value_text: value });
    } else {
      const t = value.slice(0, 2000);
      answers.push({ question_id: q.id, question_label: q.label, tag: q.tag, value_num: null, value_text: t });
      if (comment === null) comment = t;
    }
  }
  if (answers.length === 0) return { ok: false, error: "En az bir soruyu cevaplayın." };
  return { ok: true, answers, score, comment };
}

/* ----------------------------------------------------------------- sonuçlar */

export type StatTask = {
  id: string;
  event_type: string;
  status: string;
  score: number | null;
  agent_id: string | null;
  assigned_to: string | null;
};

export type StatAnswer = { task_id: string; tag: string | null; value_text: string | null };

const CLOSED: readonly string[] = ["completed", "refused", "unreachable"];

export function responseRate(tasks: readonly StatTask[]): number | null {
  const closed = tasks.filter((t) => CLOSED.includes(t.status)).length;
  if (closed === 0) return null;
  return Math.round((tasks.filter((t) => t.status === "completed").length / closed) * 100);
}

export function averageScore(tasks: readonly StatTask[]): number | null {
  const scores = tasks.filter((t) => t.status === "completed" && t.score !== null).map((t) => Number(t.score));
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

export type EventBreakdown = {
  event: SurveyEventType;
  total: number;
  pending: number;
  completed: number;
  closed: number;
  rate: number | null;
  avg: number | null;
};

export function breakdownByEvent(tasks: readonly StatTask[]): EventBreakdown[] {
  return SURVEY_EVENT_TYPES.map((event) => {
    const rows = tasks.filter((t) => t.event_type === event);
    return {
      event,
      total: rows.length,
      pending: rows.filter((t) => t.status === "pending").length,
      completed: rows.filter((t) => t.status === "completed").length,
      closed: rows.filter((t) => CLOSED.includes(t.status)).length,
      rate: responseRate(rows),
      avg: averageScore(rows),
    };
  });
}

export type AgentBreakdown = { agentId: string | null; total: number; completed: number; avg: number | null };

export function breakdownByAgent(tasks: readonly StatTask[]): AgentBreakdown[] {
  const map = new Map<string, StatTask[]>();
  for (const t of tasks) {
    const key = t.agent_id ?? "";
    map.set(key, [...(map.get(key) ?? []), t]);
  }
  return [...map.entries()]
    .map(([key, rows]) => ({
      agentId: key || null,
      total: rows.length,
      completed: rows.filter((t) => t.status === "completed").length,
      avg: averageScore(rows),
    }))
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.completed - a.completed);
}

export type ReasonCount = { reason: string; count: number };

/** "Neden" etiketli seçmeli cevapların dağılımı (en çok görülen önce). */
export function reasonDistribution(answers: readonly StatAnswer[], taskIds?: ReadonlySet<string>): ReasonCount[] {
  const counts = new Map<string, number>();
  for (const a of answers) {
    if (a.tag !== "reason" || !a.value_text) continue;
    if (taskIds && !taskIds.has(a.task_id)) continue;
    counts.set(a.value_text, (counts.get(a.value_text) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((x, y) => y.count - x.count || x.reason.localeCompare(y.reason, "tr"));
}

/** Düşük puan: ana puan eşik ve altında. */
export function isLowScore(score: number | null, lowMax: number): boolean {
  return score !== null && score <= lowMax;
}

/** Geçerli (olay, muhatap) çifti mi? */
export function isValidEventAudience(event: SurveyEventType, audience: string): boolean {
  return (EVENT_AUDIENCES[event] as readonly string[]).includes(audience);
}

/** Olay anahtarı üretimi (mükerrer önleme): aynı olay + aynı muhatap = aynı anahtar. */
export function eventKey(event: SurveyEventType, sourceId: string, audience: string, suffix?: string): string {
  return [event, sourceId, audience, suffix].filter(Boolean).join(":");
}
