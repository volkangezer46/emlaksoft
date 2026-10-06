import { shiftMonthKey, trMonthKey } from "@/lib/clock";
import {
  AUDIENCE_GROUPS,
  CSAT_SATISFIED_MIN,
  EVENT_AUDIENCES,
  NPS_DETRACTOR_MAX,
  NPS_PROMOTER_MIN,
  PULSE_MIN_RESPONSES,
  SCORE_MAX,
  SCORE_MIN,
  SURVEY_EVENT_TYPES,
  type SurveyAudience,
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
  let advisorCount = 0;
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
    let tag: SurveyQuestionDef["tag"] = q.tag === "primary" || q.tag === "reason" || q.tag === "advisor" ? q.tag : null;
    if ((tag === "primary" || tag === "advisor") && kind !== "score") tag = null;
    if (tag === "reason" && kind !== "choice") tag = null;
    if (tag === "primary") {
      primaryCount += 1;
      if (primaryCount > 1) tag = null; // yalnız ilk puan sorusu ana puandır
    }
    if (tag === "advisor") {
      advisorCount += 1;
      if (advisorCount > 1) tag = null; // tek danışman puanı
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
      if (!/^\d{1,2}$/.test(value) || !Number.isInteger(n) || n < SCORE_MIN || n > SCORE_MAX) {
        return { ok: false, error: `Puan ${SCORE_MIN} ile ${SCORE_MAX} arasında olmalı.` };
      }
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
  audience?: string | null;
  completed_at?: string | null;
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

/* ------------------------------------------------------- NPS / CSAT (0-10) */

export type ScoreStats = {
  n: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** %destekleyen − %kötüleyen (−100..100). */
  nps: number;
  /** "Memnun" (7-8) + "çok memnun" (9-10) oranı, yüzde. */
  csat: number;
  avg: number;
};

/** 0-10 puan listesinden NPS, CSAT ve ortalama. Veri yoksa null (sahte skor yok). */
export function scoreStats(scores: readonly number[]): ScoreStats | null {
  const valid = scores.filter((s) => Number.isFinite(s) && s >= SCORE_MIN && s <= SCORE_MAX);
  if (valid.length === 0) return null;
  const promoters = valid.filter((s) => s >= NPS_PROMOTER_MIN).length;
  const detractors = valid.filter((s) => s <= NPS_DETRACTOR_MAX).length;
  const satisfied = valid.filter((s) => s >= CSAT_SATISFIED_MIN).length;
  return {
    n: valid.length,
    promoters,
    passives: valid.length - promoters - detractors,
    detractors,
    nps: Math.round(((promoters - detractors) / valid.length) * 100),
    csat: Math.round((satisfied / valid.length) * 100),
    avg: Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10,
  };
}

/** Destekleyen (9-10): tavsiye daveti ve lig puanı (`nps_promoter`) aynı eşiği kullanır. */
export function isPromoter(score: number | null | undefined): boolean {
  return typeof score === "number" && score >= NPS_PROMOTER_MIN && score <= SCORE_MAX;
}

/** Ekip nabzı mı (kişiye bağlı olmayan iç anket)? Müşteri metriklerine girmez. */
export function isInternalTask(t: { event_type: string; audience?: string | null }): boolean {
  return t.event_type === "advisor_pulse" || t.audience === "advisor";
}

/** Müşteri NPS'ine giren tamamlanmış görev puanları (ekip nabzı HARİÇ). */
export function customerScores(tasks: readonly StatTask[]): number[] {
  return tasks.filter((t) => t.status === "completed" && t.score !== null && !isInternalTask(t)).map((t) => Number(t.score));
}

export type AudienceGroupRow = { id: string; label: string; audiences: readonly SurveyAudience[]; total: number; stats: ScoreStats | null };

/** Kitle grubu bazlı NPS/CSAT (alıcı-kiracı, satıcı-malik, ziyaretçi, kayıp). */
export function breakdownByAudienceGroup(tasks: readonly StatTask[]): AudienceGroupRow[] {
  return AUDIENCE_GROUPS.map((g) => {
    const rows = tasks.filter((t) => (g.audiences as readonly string[]).includes(String(t.audience ?? "")));
    return { ...g, total: rows.length, stats: scoreStats(customerScores(rows)) };
  });
}

export type EventAudienceRow = { event: SurveyEventType; audience: SurveyAudience; total: number; completed: number; stats: ScoreStats | null };

/** Olay × kitle kırılımı (yalnız görev olan çiftler; ekip nabzı hariç). */
export function breakdownByEventAudience(tasks: readonly StatTask[]): EventAudienceRow[] {
  const out: EventAudienceRow[] = [];
  for (const event of SURVEY_EVENT_TYPES) {
    if (event === "advisor_pulse") continue;
    for (const audience of EVENT_AUDIENCES[event]) {
      const rows = tasks.filter((t) => t.event_type === event && t.audience === audience);
      if (rows.length === 0) continue;
      out.push({ event, audience, total: rows.length, completed: rows.filter((t) => t.status === "completed").length, stats: scoreStats(customerScores(rows)) });
    }
  }
  return out;
}

export type TrendPoint = { month: string; stats: ScoreStats | null };

/** Son `months` TR ayının (bu ay dahil) NPS/CSAT trendi; tamamlanma ayına göre (ekip nabzı hariç). */
export function monthlyTrend(tasks: readonly StatTask[], nowMs: number, months = 6): TrendPoint[] {
  const current = trMonthKey(nowMs);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) keys.push(shiftMonthKey(current, -i) ?? current);
  const byMonth = new Map<string, number[]>();
  for (const t of tasks) {
    if (t.status !== "completed" || t.score === null || !t.completed_at || isInternalTask(t)) continue;
    const ms = Date.parse(t.completed_at);
    if (!Number.isFinite(ms)) continue;
    const k = trMonthKey(ms);
    byMonth.set(k, [...(byMonth.get(k) ?? []), Number(t.score)]);
  }
  return keys.map((month) => ({ month, stats: scoreStats(byMonth.get(month) ?? []) }));
}

/**
 * Birleşik NPS kaynakları: anket modülü görevleri + kapanış link anketi (`surveys`). Anketörün aldığı alıcı/kiracı
 * kapanış cevabı `surveys`'e de yansıtıldığından (mirror) aynı anlaşmanın alıcı/kiracı görevi tamamlandıysa eski kayıt
 * İKİNCİ KEZ sayılmaz. Satıcı/malik görevleri böylece NPS'e dahil olur.
 */
export function combinedNpsScores(
  tasks: readonly (StatTask & { deal_id?: string | null })[],
  legacy: readonly { deal_id: string | null; score: number | null; status: string }[],
): number[] {
  const mirrored = new Set(
    tasks
      .filter((t) => t.event_type === "deal_won" && (t.audience === "buyer" || t.audience === "tenant") && t.status === "completed" && t.deal_id)
      .map((t) => String(t.deal_id)),
  );
  const legacyScores = legacy
    .filter((s) => s.status === "answered" && s.score !== null && !(s.deal_id && mirrored.has(String(s.deal_id))))
    .map((s) => Number(s.score));
  return [...customerScores(tasks), ...legacyScores];
}

/* -------------------------------------------------- otomatik gönderim kuralı */

/** Görev başına en çok gönderim denemesi (başarısız deneme de sayılır; tekrar tekrar SMS yok). */
export const MAX_SEND_ATTEMPTS = 2;
/** Aynı müşteriye bu süre içinde ikinci anket mesajı gönderilmez (anket yorgunluğu + dedupe). */
export const CONTACT_COOLDOWN_DAYS = 30;
/** Ofis başına bir cron turunda en çok gönderim (maliyet ve süre sınırı). */
export const TENANT_SEND_CAP_PER_RUN = 50;
/** Bağlantı gönderilen görev, yanıt gelmezse bu kadar saat sonra anketör kuyruğuna düşer. */
export const LINK_GRACE_HOURS = 48;

export type SendCandidate = {
  status: string;
  sent_at: string | null;
  send_attempts: number;
  due_at: string;
  customer_id: string | null;
  event_type: string;
};

export type SendSkipReason = "not_due" | "not_pending" | "already_sent" | "attempts" | "no_customer" | "internal" | "cooldown" | "no_consent";
export type SendDecision = { send: true } | { send: false; reason: SendSkipReason };

/**
 * Bağlı anket linki otomatik gönderilsin mi? (saf; kanal/izin bilgisi çağırandan gelir)
 * Yalnız müşteri kaydı olan (İYS izni müşteriye bağlıdır), vadesi gelmiş, daha önce gönderilmemiş bekleyen görev;
 * aynı müşteriye son 30 günde anket mesajı gitmediyse ve ilgili kanalda İYS izni "granted" ise.
 */
export function autoSendDecision(t: SendCandidate, ctx: { nowMs: number; consentGranted: boolean; contactRecentlySent: boolean }): SendDecision {
  if (t.event_type === "advisor_pulse") return { send: false, reason: "internal" };
  if (t.status !== "pending") return { send: false, reason: "not_pending" };
  if (t.sent_at) return { send: false, reason: "already_sent" };
  if (t.send_attempts >= MAX_SEND_ATTEMPTS) return { send: false, reason: "attempts" };
  const due = Date.parse(t.due_at);
  if (!Number.isFinite(due) || due > ctx.nowMs) return { send: false, reason: "not_due" };
  if (!t.customer_id) return { send: false, reason: "no_customer" };
  if (ctx.contactRecentlySent) return { send: false, reason: "cooldown" };
  if (!ctx.consentGranted) return { send: false, reason: "no_consent" };
  return { send: true };
}

/** SMS metni: ofis adı + kısa çağrı + bağlantı (kişisel veri/işlem ayrıntısı YOK). */
export function surveySmsText(office: string, url: string): string {
  const name = office.trim().slice(0, 40) || "Emlak ofisi";
  return `${name}: Görüşünüz bizim için değerli. 1 dakikalık anketimize katılır mısınız? ${url}`;
}

/* --------------------------------------------------- düşük puan zinciri */

/** Takip görevi bu sürede kapanmazsa takım liderine, ikinci eşikte ofis sahibine bildirilir. */
export const LOW_SCORE_TEAM_LEAD_HOURS = 24;
export const LOW_SCORE_OWNER_HOURS = 48;

/** Zincirde ulaşılması gereken kademe (0 yok, 1 takım lideri, 2 ofis sahibi). Kapanmış takipte 0. */
export function lowScoreEscalationTarget(input: { completedAtMs: number; handled: boolean; nowMs: number }): 0 | 1 | 2 {
  if (input.handled || !Number.isFinite(input.completedAtMs)) return 0;
  const hours = (input.nowMs - input.completedAtMs) / HOUR_MS;
  if (hours >= LOW_SCORE_OWNER_HOURS) return 2;
  if (hours >= LOW_SCORE_TEAM_LEAD_HOURS) return 1;
  return 0;
}

/** Aksiyon notu kuralı (UI + RPC aynı): 10-2000 karakter. */
export const LOW_SCORE_NOTE_MIN = 10;
export function validLowScoreNote(note: string): boolean {
  const t = note.trim();
  return t.length >= LOW_SCORE_NOTE_MIN && t.length <= 2000;
}

/* ----------------------------------------------------------- kira olayları */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Kira yenileme olayı tarihi: bitişten 60 gün önce. Geçersiz tarih null. */
export const RENT_RENEWAL_LEAD_DAYS = 60;
export function rentRenewalEventDate(endDate: string | null | undefined): string | null {
  if (!endDate || !ISO_DATE.test(endDate.slice(0, 10))) return null;
  return addDaysToDate(endDate.slice(0, 10), -RENT_RENEWAL_LEAD_DAYS);
}

/** Bugüne kadarki en son kira yıl dönümü (en az 1. yıl). Yoksa null. 29 Şubat başlangıcı 28 Şubat'a düşer. */
export function latestRentAnniversary(startDate: string | null | undefined, todayDate: string): { year: number; date: string } | null {
  if (!startDate || !ISO_DATE.test(startDate.slice(0, 10)) || !ISO_DATE.test(todayDate)) return null;
  const [sy, sm, sd] = startDate.slice(0, 10).split("-").map(Number) as [number, number, number];
  const ty = Number(todayDate.slice(0, 4));
  for (let y = ty; y > sy; y--) {
    const lastDay = new Date(Date.UTC(y, sm, 0)).getUTCDate();
    const date = `${y}-${String(sm).padStart(2, "0")}-${String(Math.min(sd, lastDay)).padStart(2, "0")}`;
    if (date <= todayDate) return { year: y - sy, date };
  }
  return null;
}

/* ------------------------------------------------------------- ekip nabzı */

export type PulseSummary =
  | { visible: false; n: number }
  | { visible: true; n: number; stats: ScoreStats; reasons: ReasonCount[]; comments: string[] };

/**
 * Ekip nabzı toplu sonucu. Anonimlik: `PULSE_MIN_RESPONSES` altında hiçbir sayı/yorum gösterilmez; yorumlar
 * tarih/sıra bilgisi taşımasın diye alfabetik sıralanır. `comments`: yalnız serbest metin sorularının cevapları.
 */
export function pulseSummary(
  tasks: readonly { id: string; score: number | null }[],
  reasonAnswers: readonly StatAnswer[],
  comments: readonly string[],
  min = PULSE_MIN_RESPONSES,
): PulseSummary {
  const n = tasks.length;
  const stats = scoreStats(tasks.filter((t) => t.score !== null).map((t) => Number(t.score)));
  if (n < min || !stats) return { visible: false, n };
  const ids = new Set(tasks.map((t) => t.id));
  return {
    visible: true,
    n,
    stats,
    reasons: reasonDistribution(reasonAnswers, ids),
    comments: comments.map((c) => c.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, "tr")),
  };
}
