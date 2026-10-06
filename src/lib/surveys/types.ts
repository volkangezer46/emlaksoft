/**
 * Anket modülü ortak türleri ve sabitleri (saf veri; istemciden de import edilir).
 *
 * Olay türü = anketin tetiklendiği iş olayı. Muhatap (audience) = anketin kime sorulduğu;
 * aynı olayda farklı muhataplar için ayrı şablon vardır (alıcı, satıcı, kiracı, ev sahibi...).
 * Kitle × tetik matrisi: olay (tetikleyici) açık/kapalı + gecikme günü `survey_triggers`'ta, kitle bazında
 * aç/kapa ise o (olay, kitle) şablonunun `active` bayrağıdır (pasif şablon = o kitleye anket üretilmez).
 */

export const SURVEY_EVENT_TYPES = [
  "property_unpublished",
  "authority_extended",
  "deal_won",
  "deal_lost",
  "demand_lost",
  "appointment_done",
  "rent_renewal",
  "tenant_annual",
  "advisor_pulse",
] as const;
export type SurveyEventType = (typeof SURVEY_EVENT_TYPES)[number];

export const SURVEY_AUDIENCES = ["owner", "buyer", "seller", "tenant", "landlord", "customer", "visitor", "advisor"] as const;
export type SurveyAudience = (typeof SURVEY_AUDIENCES)[number];

export const SURVEY_QUESTION_KINDS = ["score", "choice", "yesno", "text"] as const;
export type SurveyQuestionKind = (typeof SURVEY_QUESTION_KINDS)[number];

/** Soru etiketi: ana puan (NPS/memnuniyet), neden dağılımı, danışman puanı. */
export type SurveyQuestionTag = "primary" | "reason" | "advisor";

export const SURVEY_TASK_STATUSES = ["pending", "completed", "refused", "unreachable", "cancelled"] as const;
export type SurveyTaskStatus = (typeof SURVEY_TASK_STATUSES)[number];

export const SURVEY_OUTCOMES = ["no_answer", "busy", "wrong_number", "refused", "completed", "reassigned"] as const;
export type SurveyOutcome = (typeof SURVEY_OUTCOMES)[number];

export const SURVEY_ASSIGNMENT_MODES = ["balanced", "selected", "manual"] as const;
export type SurveyAssignmentMode = (typeof SURVEY_ASSIGNMENT_MODES)[number];

/** TEK ÖLÇEK: tüm puan soruları 0-10 (NPS bantları 0-6 / 7-8 / 9-10). */
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
/** NPS: 9-10 destekleyen, 0-6 kötüleyen. */
export const NPS_PROMOTER_MIN = 9;
export const NPS_DETRACTOR_MAX = 6;
/** CSAT = "memnun" (7-8) + "çok memnun" (9-10) oranı. */
export const CSAT_SATISFIED_MIN = 7;
/** Ekip nabzı: anonimlik için en az bu kadar cevap yoksa sonuç gösterilmez. */
export const PULSE_MIN_RESPONSES = 3;

export const EVENT_LABELS: Record<SurveyEventType, string> = {
  property_unpublished: "Yayından kalkan ilan / yetki bitimi",
  authority_extended: "Yetki süresi uzatıldı",
  deal_won: "İşlem gördü (anlaşma kapanışı)",
  deal_lost: "Kaybedilen anlaşma",
  demand_lost: "Kapanan talep",
  appointment_done: "Gösterim / randevu sonrası",
  rent_renewal: "Kira bitişine 60 gün",
  tenant_annual: "Kiracı yıllık anketi",
  advisor_pulse: "Ekip nabzı (danışman iç anketi)",
};

export const EVENT_DESCRIPTIONS: Record<SurveyEventType, string> = {
  property_unpublished:
    "İlan satıldı, kiralandı, malik vazgeçti veya yetki süresi doldu: ilan sahibine nedeni ve memnuniyeti (0-10) sorulur.",
  authority_extended: "Yetki süresi uzatılan ilanın sahibine neden devam ettiği ve beklentisi sorulur.",
  deal_won: "Kazanılan anlaşmada alıcı/kiracıya tavsiye puanı ve danışman puanı, satıcı/ev sahibine ayrı şablonla sorulur.",
  deal_lost: "Kaybedilen anlaşmanın müşterisine kayıp nedeni sorulur.",
  demand_lost: "Kapanan talebin sahibine arayışının neden sona erdiği sorulur.",
  appointment_done: "Tamamlanan gösterim sonrası ziyaretçiye kısa memnuniyet; sonuç malik raporuna yansır.",
  rent_renewal: "Kira sözleşmesinin bitişinden 60 gün önce kiracıya yenileme niyeti ve memnuniyet sorulur.",
  tenant_annual: "Kira başlangıcının her yıl dönümünde kiracıya memnuniyet ve ihtiyaç sorulur.",
  advisor_pulse:
    "Ayda bir ekibe ofis içi memnuniyet ve ihtiyaç sorulur. ANONİMDİR: cevap kişiye bağlanmaz, yalnız toplu sonuç (en az 3 cevap) görünür.",
};

export const AUDIENCE_LABELS: Record<SurveyAudience, string> = {
  owner: "İlan sahibi (malik)",
  buyer: "Alıcı",
  seller: "Satıcı",
  tenant: "Kiracı",
  landlord: "Ev sahibi",
  customer: "Kaybedilen müşteri",
  visitor: "Gösterim ziyaretçisi",
  advisor: "Danışman (iç anket)",
};

/** Raporlarda kitle grupları (NPS kırılımı). Ekip nabzı müşteri NPS'ine KATILMAZ. */
export const AUDIENCE_GROUPS: { id: string; label: string; audiences: readonly SurveyAudience[] }[] = [
  { id: "alici", label: "Alıcı / kiracı", audiences: ["buyer", "tenant"] },
  { id: "satici", label: "Satıcı / malik", audiences: ["seller", "landlord", "owner"] },
  { id: "ziyaretci", label: "Gösterim ziyaretçisi", audiences: ["visitor"] },
  { id: "kayip", label: "Kaybedilen müşteri", audiences: ["customer"] },
];

export const KIND_LABELS: Record<SurveyQuestionKind, string> = {
  score: "Puan (0-10)",
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
  rent_renewal: ["tenant"],
  tenant_annual: ["tenant"],
  advisor_pulse: ["advisor"],
};

/** Varsayılan gecikme (gün): alıcı/kiracı kapanış +3, gösterim +1; kira olayları kendi tarihinde. */
export const EVENT_DEFAULT_DELAY_DAYS: Record<SurveyEventType, number> = {
  property_unpublished: 2,
  authority_extended: 2,
  deal_won: 3,
  deal_lost: 2,
  demand_lost: 2,
  appointment_done: 1,
  rent_renewal: 0,
  tenant_annual: 0,
  advisor_pulse: 0,
};

/** Kuyruk/anketör akışına girmeyen (kişiye bağlanmayan) olaylar. */
export const INTERNAL_EVENTS: readonly SurveyEventType[] = ["advisor_pulse"];

export type SurveyQuestionDef = {
  id?: string;
  kind: SurveyQuestionKind;
  label: string;
  options: string[];
  required: boolean;
  tag: SurveyQuestionTag | null;
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

/** Varsayılan ayarlar (satır yoksa / sütun yoksa kullanılır). */
export const DEFAULT_SURVEY_SETTINGS = {
  assignment_mode: "balanced" as SurveyAssignmentMode,
  fixed_assignee: null as string | null,
  overdue_hours: 48,
  retry_hours: 24,
  low_score_max: 6,
  auto_send: false,
  whatsapp_template: null as string | null,
  whatsapp_language: "tr",
  promoter_invite: true,
};
export type SurveySettings = typeof DEFAULT_SURVEY_SETTINGS;

export const DEFAULT_DELAY_DAYS = 2;
export const DEFAULT_MAX_ATTEMPTS = 3;
