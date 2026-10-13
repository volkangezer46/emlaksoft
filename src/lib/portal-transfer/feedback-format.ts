import { FILL_FIELD_KEYS, TRANSFER_PORTALS, fold, type FillFieldKey, type TransferPortal } from "./rules";

/**
 * GERİ BİLDİRİM YÜKÜ v1 (SAF, testli; eklenti ve sunucu ORTAK). Yalnız açık rızayla üretilir; form ŞEMASI ve sonuç türü
 * taşır, kullanıcı DEĞERİ taşımaz (`value`/`current`/`checked`/`text`/`title`/`description` alanı yoktur, sunucudaki zod
 * `.strict()` reddeder). Kişisel veri süzgeci iki tarafta da aynı fonksiyondur (`sanitizeFeedbackPayload`); sunucu ayrıca
 * `Redactor` ve SQL desen kontrolü uygular.
 *
 * Atılan etiket/seçenek: ≥4 ardışık rakam, toplamda ≥7 rakam (boşluklu telefon "532 123 45 67"), '@', 'http', 'www',
 * TC/IBAN kalıbı, ardışık ≥3 sayı sözcüğü ("bes uc iki"), 60 karakterden uzun. Etiketi kişisel sözcük içeren denetim
 * (iletişim, telefon, ad soyad, danışman, mağaza, ofis ...) TÜMÜYLE atılır. Seçeneklerinin %30'undan fazlası atılan
 * denetimin seçenek listesi tümden boşaltılır (kayıtlı telefonları listeleyen select'ler). Etiket yalnız denetime bağlı
 * kaynaklardan gelir (`labelSource`; komşu metin GÖNDERİLMEZ — eleştirmen Y1).
 */

export const FEEDBACK_VERSION = 1 as const;
/** Rıza kartı metin sürümü; sunucu bundan küçük/eksik rızalı yükü reddeder (Y6). */
export const FEEDBACK_CONSENT_TEXT_VERSION = 1;
export const FEEDBACK_MAX_BYTES = 48_000;
export const FEEDBACK_LIMITS = { maxFields: 120, maxOptions: 60, maxText: 60, maxOptionDropShare: 0.3 } as const;

export const FEEDBACK_PHASES = ["filled", "checked", "published"] as const;
export type FeedbackPhase = (typeof FEEDBACK_PHASES)[number];
export const FEEDBACK_OUTCOMES = ["filled", "accepted", "corrected", "cleared", "not_found", "no_option", "already_filled", "unmatched"] as const;
export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number];
export const FEEDBACK_CONTROLS = ["text", "number", "textarea", "choice", "bool"] as const;
export type FeedbackControl = (typeof FEEDBACK_CONTROLS)[number];
/** Denetime BAĞLI etiket kaynakları. Komşu metin (previousElementSibling vb.) bilerek yok. */
export const LABEL_SOURCES = ["label_for", "aria_label", "aria_labelledby", "legend", "placeholder", "name", "id"] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/** Etiketinde bu sözcüklerden biri (katlanmış, sözcük olarak) geçen denetim tümüyle atılır. */
export const PERSONAL_LABEL_WORDS = [
  "iletisim",
  "telefon",
  "tel",
  "cep",
  "gsm",
  "whatsapp",
  "e posta",
  "eposta",
  "mail",
  "email",
  "ad soyad",
  "adi soyadi",
  "adiniz",
  "soyad",
  "soyadi",
  "isim",
  "yetkili",
  "firma",
  "danisman",
  "temsilci",
  "sorumlu",
  "magaza",
  "ofis",
  "sube",
  "kullanici",
  "unvan",
  "tc",
  "kimlik",
  "iban",
] as const;

export type FeedbackCorrection =
  | { kind: "other_option"; option: string; valueKey?: string }
  | { kind: "value_edited"; category: "format" | "rewritten" }
  | { kind: "cleared" };

export type FeedbackField = {
  sig: string;
  key: FillFieldKey | null;
  control: FeedbackControl;
  label: string;
  labelSource: LabelSource;
  options: string[];
  required: boolean;
  outcome: FeedbackOutcome;
  correction?: FeedbackCorrection;
  anchorHit?: boolean;
};

export type FeedbackPayload = {
  v: typeof FEEDBACK_VERSION;
  sessionId: string;
  portal: TransferPortal;
  engine: "f1";
  ruleVersion: number;
  ruleSha: string;
  phase: FeedbackPhase;
  formFp: string;
  rulesRegressed: boolean;
  consentTextVersion: number;
  counts: { controls: number; droppedPii: number };
  fields: FeedbackField[];
};

export type SanitizeResult = { payload: FeedbackPayload | null; dropped: number; reason?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const RULE_SHA = /^[0-9a-f]{16,64}$/;
const VALUE_KEY = /^[a-z0-9 ]{1,40}$/;
const NUMBER_WORDS = new Set(["sifir", "bir", "iki", "uc", "dort", "bes", "alti", "yedi", "sekiz", "dokuz", "on"]);

const ROOT_KEYS = ["consentTextVersion", "counts", "engine", "fields", "formFp", "phase", "portal", "ruleSha", "ruleVersion", "rulesRegressed", "sessionId", "v"];
const FIELD_KEYS = ["anchorHit", "control", "correction", "key", "label", "labelSource", "options", "outcome", "required", "sig"];
const FIELD_REQUIRED = ["control", "key", "label", "labelSource", "options", "outcome", "required", "sig"];

const wordIn = (haystack: string, phrase: string) => ` ${haystack} `.includes(` ${phrase} `);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Etiket/seçenek metni kişisel veri deseni taşıyor mu? (katlanmamış ham metin de verilebilir) */
export function looksPersonal(text: string): boolean {
  const raw = String(text ?? "");
  if (raw.length > FEEDBACK_LIMITS.maxText) return true;
  const low = raw.toLowerCase();
  if (/\d{4,}/.test(raw)) return true;
  if ((raw.match(/\d/g) ?? []).length >= 7) return true;
  if (low.includes("@") || low.includes("http") || low.includes("www")) return true;
  if (/\btr\s?\d{2}/i.test(raw)) return true;
  const words = fold(raw).split(" ");
  let run = 0;
  for (const w of words) {
    run = NUMBER_WORDS.has(w) ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

/** Etiket kişisel bir denetimi mi tarif ediyor (iletişim, ad soyad, danışman ...)? */
export function isPersonalLabel(label: string): boolean {
  const f = fold(label);
  return PERSONAL_LABEL_WORDS.some((w) => f === w || wordIn(f, w));
}

export function feedbackKey(p: Pick<FeedbackPayload, "sessionId" | "phase">): string {
  return `${p.sessionId}:${p.phase}`;
}

function sanitizeField(raw: unknown): { field: FeedbackField | null; droppedItems: number } {
  if (!isPlainObject(raw)) return { field: null, droppedItems: 1 };
  for (const k of Object.keys(raw)) if (!FIELD_KEYS.includes(k)) return { field: null, droppedItems: 1 };
  for (const k of FIELD_REQUIRED) if (!(k in raw)) return { field: null, droppedItems: 1 };
  const { sig, key, control, label, labelSource, options, required, outcome, correction, anchorHit } = raw;
  if (typeof sig !== "string" || !HEX64.test(sig)) return { field: null, droppedItems: 1 };
  if (key !== null && (typeof key !== "string" || !(FILL_FIELD_KEYS as readonly string[]).includes(key))) return { field: null, droppedItems: 1 };
  if (typeof control !== "string" || !(FEEDBACK_CONTROLS as readonly string[]).includes(control)) return { field: null, droppedItems: 1 };
  if (typeof labelSource !== "string" || !(LABEL_SOURCES as readonly string[]).includes(labelSource)) return { field: null, droppedItems: 1 };
  if (typeof outcome !== "string" || !(FEEDBACK_OUTCOMES as readonly string[]).includes(outcome)) return { field: null, droppedItems: 1 };
  if (typeof required !== "boolean") return { field: null, droppedItems: 1 };
  if (anchorHit !== undefined && typeof anchorHit !== "boolean") return { field: null, droppedItems: 1 };
  if (typeof label !== "string" || !Array.isArray(options)) return { field: null, droppedItems: 1 };
  const flabel = fold(label);
  if (!flabel || looksPersonal(label) || isPersonalLabel(label)) return { field: null, droppedItems: 1 };

  // Seçenekler: katlanır, kişisel olanlar atılır; %30'dan fazlası atıldıysa liste tümden boşalır.
  const rawOptions = options.slice(0, FEEDBACK_LIMITS.maxOptions);
  let droppedItems = options.length - rawOptions.length;
  const kept: string[] = [];
  let droppedOptions = 0;
  for (const o of rawOptions) {
    if (typeof o !== "string" || looksPersonal(o) || !fold(o)) {
      droppedOptions++;
      continue;
    }
    const fo = fold(o);
    if (!kept.includes(fo)) kept.push(fo);
  }
  droppedItems += droppedOptions;
  let finalOptions = kept;
  if (rawOptions.length > 0 && droppedOptions / rawOptions.length > FEEDBACK_LIMITS.maxOptionDropShare) {
    droppedItems += kept.length;
    finalOptions = [];
  }

  let corr: FeedbackCorrection | undefined;
  if (correction !== undefined) {
    if (!isPlainObject(correction)) return { field: null, droppedItems: droppedItems + 1 };
    if (correction.kind === "other_option") {
      for (const k of Object.keys(correction)) if (!["kind", "option", "valueKey"].includes(k)) return { field: null, droppedItems: droppedItems + 1 };
      const opt = typeof correction.option === "string" ? fold(correction.option) : "";
      // Düzeltilen seçenek yalnız portalın kendi sözlüğünden (bu denetimin seçenekleri) olabilir.
      if ((control !== "choice" && control !== "bool") || !opt || !finalOptions.includes(opt)) return { field: null, droppedItems: droppedItems + 1 };
      const vk = correction.valueKey;
      if (vk !== undefined && (typeof vk !== "string" || !VALUE_KEY.test(vk) || fold(vk) !== vk)) return { field: null, droppedItems: droppedItems + 1 };
      corr = vk ? { kind: "other_option", option: opt, valueKey: vk } : { kind: "other_option", option: opt };
    } else if (correction.kind === "value_edited") {
      for (const k of Object.keys(correction)) if (!["kind", "category"].includes(k)) return { field: null, droppedItems: droppedItems + 1 };
      if (correction.category !== "format" && correction.category !== "rewritten") return { field: null, droppedItems: droppedItems + 1 };
      corr = { kind: "value_edited", category: correction.category };
    } else if (correction.kind === "cleared") {
      if (Object.keys(correction).length !== 1) return { field: null, droppedItems: droppedItems + 1 };
      corr = { kind: "cleared" };
    } else {
      return { field: null, droppedItems: droppedItems + 1 };
    }
  }

  const field: FeedbackField = {
    sig,
    key: key as FillFieldKey | null,
    control: control as FeedbackControl,
    label: flabel.slice(0, FEEDBACK_LIMITS.maxText),
    labelSource: labelSource as LabelSource,
    options: finalOptions,
    required,
    outcome: outcome as FeedbackOutcome,
  };
  if (corr) field.correction = corr;
  if (anchorHit !== undefined) field.anchorHit = anchorHit;
  return { field, droppedItems };
}

/**
 * Yükü sınırlar ve kişisel veri süzgecinden geçirir. Yapısal hata (bilinmeyen kök anahtarı, yanlış tür) → payload null +
 * reason. Kişisel veriye takılan öğe isteği düşürmez: o öğe atılır, `dropped` artar.
 */
export function sanitizeFeedbackPayload(raw: unknown): SanitizeResult {
  if (!isPlainObject(raw)) return { payload: null, dropped: 0, reason: "not_object" };
  for (const k of Object.keys(raw)) if (!ROOT_KEYS.includes(k)) return { payload: null, dropped: 0, reason: `unknown_key:${k}` };
  for (const k of ROOT_KEYS) if (!(k in raw)) return { payload: null, dropped: 0, reason: `missing:${k}` };
  if (raw.v !== FEEDBACK_VERSION) return { payload: null, dropped: 0, reason: "version" };
  if (typeof raw.sessionId !== "string" || !UUID_RE.test(raw.sessionId)) return { payload: null, dropped: 0, reason: "session" };
  if (typeof raw.portal !== "string" || !(TRANSFER_PORTALS as readonly string[]).includes(raw.portal)) return { payload: null, dropped: 0, reason: "portal" };
  if (raw.engine !== "f1") return { payload: null, dropped: 0, reason: "engine" };
  if (typeof raw.ruleVersion !== "number" || !Number.isInteger(raw.ruleVersion) || raw.ruleVersion < 0 || raw.ruleVersion > 2_147_483_647) return { payload: null, dropped: 0, reason: "rule_version" };
  if (typeof raw.ruleSha !== "string" || !RULE_SHA.test(raw.ruleSha)) return { payload: null, dropped: 0, reason: "rule_sha" };
  if (typeof raw.phase !== "string" || !(FEEDBACK_PHASES as readonly string[]).includes(raw.phase)) return { payload: null, dropped: 0, reason: "phase" };
  if (typeof raw.formFp !== "string" || !HEX64.test(raw.formFp)) return { payload: null, dropped: 0, reason: "form_fp" };
  if (typeof raw.rulesRegressed !== "boolean") return { payload: null, dropped: 0, reason: "rules_regressed" };
  if (typeof raw.consentTextVersion !== "number" || !Number.isInteger(raw.consentTextVersion) || raw.consentTextVersion < FEEDBACK_CONSENT_TEXT_VERSION) {
    return { payload: null, dropped: 0, reason: "consent" };
  }
  const counts = raw.counts;
  if (!isPlainObject(counts) || Object.keys(counts).sort().join(",") !== "controls,droppedPii") return { payload: null, dropped: 0, reason: "counts" };
  const controls = counts.controls;
  const droppedPii = counts.droppedPii;
  if (typeof controls !== "number" || !Number.isInteger(controls) || controls < 0 || controls > 2000) return { payload: null, dropped: 0, reason: "counts" };
  if (typeof droppedPii !== "number" || !Number.isInteger(droppedPii) || droppedPii < 0 || droppedPii > 2000) return { payload: null, dropped: 0, reason: "counts" };
  if (!Array.isArray(raw.fields)) return { payload: null, dropped: 0, reason: "fields" };

  let dropped = Math.max(0, raw.fields.length - FEEDBACK_LIMITS.maxFields);
  const fields: FeedbackField[] = [];
  const seen = new Set<string>();
  for (const rf of raw.fields.slice(0, FEEDBACK_LIMITS.maxFields)) {
    const r = sanitizeField(rf);
    dropped += r.droppedItems;
    if (!r.field) continue;
    if (seen.has(r.field.sig)) {
      dropped++;
      continue;
    }
    seen.add(r.field.sig);
    fields.push(r.field);
  }
  return {
    payload: {
      v: FEEDBACK_VERSION,
      sessionId: raw.sessionId.toLowerCase(),
      portal: raw.portal as TransferPortal,
      engine: "f1",
      ruleVersion: raw.ruleVersion,
      ruleSha: raw.ruleSha,
      phase: raw.phase as FeedbackPhase,
      formFp: raw.formFp,
      rulesRegressed: raw.rulesRegressed,
      consentTextVersion: raw.consentTextVersion,
      counts: { controls, droppedPii: droppedPii + dropped },
      fields,
    },
    dropped,
  };
}
