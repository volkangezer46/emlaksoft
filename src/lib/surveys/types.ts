/**
 * Anket modülü ortak türleri ve sabitleri (saf veri; istemciden de import edilir).
 *
 * Olay türü = anketin tetiklendiği iş olayı. Muhatap (audience) = anketin kime sorulduğu;
 * aynı olayda farklı muhataplar için ayrı şablon vardır (alıcı, satıcı, kiracı, ev sahibi...).
 */

export const SURVEY_EVENT_TYPES = [
  "property_unpublished",
  "authority_extended",
  "deal_won",
  "deal_lost",
  "demand_lost",
  "appointment_done",
] as const;
export type SurveyEventType = (typeof SURVEY_EVENT_TYPES)[number];

export const SURVEY_AUDIENCES = ["owner", "buyer", "seller", "tenant", "landlord", "customer", "visitor"] as const;
export type SurveyAudience = (typeof SURVEY_AUDIENCES)[number];

export const SURVEY_QUESTION_KINDS = ["score", "choice", "yesno", "text"] as const;
export type SurveyQuestionKind = (typeof SURVEY_QUESTION_KINDS)[number];

export const SURVEY_TASK_STATUSES = ["pending", "completed", "refused", "unreachable", "cancelled"] as const;
export type SurveyTaskStatus = (typeof SURVEY_TASK_STATUSES)[number];

export const SURVEY_OUTCOMES = ["no_answer", "busy", "wrong_number", "refused", "completed", "reassigned"] as const;
export type SurveyOutcome = (typeof SURVEY_OUTCOMES)[number];

export const SURVEY_ASSIGNMENT_MODES = ["balanced", "selected", "manual"] as const;
export type SurveyAssignmentMode = (typeof SURVEY_ASSIGNMENT_MODES)[number];

export const EVENT_LABELS: Record<SurveyEventType, string> = {
  property_unpublished: "Yayından kalkan ilan",
  authority_extended: "Yetki süresi uzatıldı",
  deal_won: "İşlem gördü (anlaşma)",
  deal_lost: "Kaybedilen anlaşma",
  demand_lost: "Kapanan talep",
  appointment_done: "Ziyaret / randevu sonrası",
};

export const EVENT_DESCRIPTIONS: Record<SurveyEventType, string> = {
  property_unpublished:
    "İlan satıldı, kiralandı, malik vazgeçti veya yetki süresi doldu: ilan sahibine nedeni ve memnuniyeti sorulur.",
  authority_extended: "Yetki süresi uzatılan ilanın sahibine neden devam ettiği ve beklentisi sorulur.",
  deal_won: "Kazanılan anlaşmada alıcı/kiracı ile satıcı/ev sahibine ayrı şablonla memnuniyet sorulur.",
  deal_lost: "Kaybedilen anlaşmanın müşterisine neden gerçekleşmediği sorulur.",
  demand_lost: "Kapanan talebin sahibine arayışının neden sona erdiği sorulur.",
  appointment_done: "Tamamlanan ziyaret veya görüşme sonrası kısa geri bildirim alınır.",
};

export const AUDIENCE_LABELS: Record<SurveyAudience, string> = {
  owner: "İlan sahibi (malik)",
  buyer: "Alıcı",
  seller: "Satıcı",
  tenant: "Kiracı",
  landlord: "Ev sahibi",
  customer: "Müşteri",
  visitor: "Ziyaretçi",
};

export const KIND_LABELS: Record<SurveyQuestionKind, string> = {
  score: "Puan (1-10)",
  choice: "Çoktan seçmeli",
  yesno: "Evet / Hayır",
  text: "Serbest metin",
};

export const STATUS_LABELS: Record<SurveyTaskStatus, string> = {
  pending: "Bekliyor",
  completed: "Tamamlandı",
  refused: "Reddetti",
  unreachable: "Ulaşılamadı",
  cancelled: "İptal",
};

export const OUTCOME_LABELS: Record<SurveyOutcome, string> = {
  no_answer: "Açmadı",
  busy: "Meşgul",
  wrong_number: "Yanlış numara",
  refused: "Reddetti",
  completed: "Tamamlandı",
  reassigned: "Yeniden atandı",
};

/** Olay türüne göre geçerli muhataplar (şablon ve görev bu çiftlerle üretilir). */
export const EVENT_AUDIENCES: Record<SurveyEventType, readonly SurveyAudience[]> = {
  property_unpublished: ["owner"],
  authority_extended: ["owner"],
  deal_won: ["buyer", "seller", "tenant", "landlord"],
  deal_lost: ["customer"],
  demand_lost: ["customer"],
  appointment_done: ["visitor"],
};

export type SurveyQuestionDef = {
  id?: string;
  kind: SurveyQuestionKind;
  label: string;
  options: string[];
  required: boolean;
  tag: "primary" | "reason" | null;
};

export function isSurveyEventType(v: unknown): v is SurveyEventType {
  return typeof v === "string" && (SURVEY_EVENT_TYPES as readonly string[]).includes(v);
}
export function isSurveyAudience(v: unknown): v is SurveyAudience {
  return typeof v === "string" && (SURVEY_AUDIENCES as readonly string[]).includes(v);
}
export function isSurveyStatus(v: unknown): v is SurveyTaskStatus {
  return typeof v === "string" && (SURVEY_TASK_STATUSES as readonly string[]).includes(v);
}

/** Varsayılan ayarlar (satır yoksa kullanılır). */
export const DEFAULT_SURVEY_SETTINGS = {
  assignment_mode: "balanced" as SurveyAssignmentMode,
  fixed_assignee: null as string | null,
  overdue_hours: 48,
  retry_hours: 24,
  low_score_max: 6,
};
export type SurveySettings = typeof DEFAULT_SURVEY_SETTINGS;

export const DEFAULT_DELAY_DAYS = 2;
export const DEFAULT_MAX_ATTEMPTS = 3;
