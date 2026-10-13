import { FIELD_RULES, FILL_FIELD_KEYS, TRANSFER_PORTALS, fold, type FillControl, type FillFieldKey, type TransferPortal } from "./rules";

/**
 * KURAL SETİ BİÇİMİ 1 (SAF, testli; eklenti ve sunucu ORTAK kullanır, `server-only` YOK). Sunucudan gelen kural yalnız
 * VERİDİR: etiket eş anlamlıları, tam eşleşme listeleri, alan imzası çapaları (16 hex), seçenek takma adları, alan durumu ve
 * güveni, form sayısal parametreleri, form parmak izleri. Regex, CSS seçici, URL, adım dizisi ya da metin şablonu YOK (MV3).
 *
 * Doğrulayıcı KATIDIR: bilinmeyen anahtar → ret. Ayrıca zehirlemeye karşı ek kurallar (eleştirmen Y5): etiket en az 3
 * karakter ve en az 1 harf; aynı etiket iki anahtarda bulunamaz; tohumun etiketi başka anahtara taşınamaz; denetim türü
 * tohumla aynı olmalı; RİSKLİ anahtarlar (fiyat, para birimi, tapu, kredi, takas, EİDS, yetki belgesi) uzak veriyle
 * genişletilemez; seçenek takma adı evet/hayır yönünü ters çeviremez. Süre (K3/K4): `issuedAt`/`expiresAt` imzalı içerikte;
 * süresi dolan set yerine tohum kullanılır (`isRuleSetExpired`).
 */

export const FORM_RULES_FORMAT = 1 as const;
export const FORM_RULES_ENGINE = "f1" as const;

export const RULE_LIMITS = {
  /** Tek kural setinin kanonik JSON bayt sınırı (zarf başına; eleştirmen O1). */
  maxBytes: 65_536,
  /** Bir yanıttaki tüm zarfların toplam sınırı (3 portal). */
  maxResponseBytes: 229_376,
  maxVersion: 2_147_483_647,
  maxFields: 60,
  maxLabels: 12,
  maxExact: 6,
  maxAnchors: 8,
  maxOptionKeys: 40,
  maxOptionAliases: 8,
  maxText: 60,
  minLabel: 3,
  maxPlaceholders: 20,
  maxPlaceholder: 40,
  maxFingerprints: 40,
  maxKeyList: 29,
  /** Yayınlanan setin ömrü (gün); sunucu süresi yaklaşan seti yeniden imzalar. */
  ttlDays: 14,
  /** `expiresAt - issuedAt` üst sınırı (gün; tohum hariç). */
  maxTtlDays: 30,
} as const;

export const RULE_CONTROLS = ["text", "number", "textarea", "choice", "bool"] as const satisfies readonly FillControl[];
export const RULE_FIELD_STATES = ["verified", "unverified", "degraded", "disabled"] as const;
export type RuleFieldState = (typeof RULE_FIELD_STATES)[number];

/**
 * Hatalı değerin yasal/mali sonuç doğurduğu anahtarlar (eleştirmen Y5): uzak veri bunların etiket/tam eşleşme listesini
 * tohumun ÖTESİNE genişletemez, çapa ve seçenek takma adı ekleyemez. Eklenti bu alanları `degraded`/`unverified` iken
 * doldurmaz ("elle doldurun").
 */
export const RISKY_FIELD_KEYS: readonly FillFieldKey[] = [
  "price",
  "currency",
  "deed_status",
  "credit_eligible",
  "swap",
  "eids_property_no",
  "authority_doc_no",
];

/** Seçenek takma adında yön kontrolü (fill-plan.ts YES/NO ile aynı sözcükler). */
const YES_WORDS = ["evet", "var", "mevcut", "uygun", "esyali", "kapali"];
const NO_WORDS = ["hayir", "yok", "esyasiz", "uygun degil"];

export type RuleField = {
  key: FillFieldKey;
  control: FillControl;
  labels: string[];
  exact: string[];
  anchors: string[];
  /** EmlakSoft değerinin katlanmış hali → portal seçenek metni takma adları (katlanmış). */
  options: Record<string, string[]>;
  state: RuleFieldState;
  confidence: number;
};

export type RuleSetForm = {
  maxPhotos: number;
  titleMax: number;
  required: FillFieldKey[];
  recommended: { residential: FillFieldKey[]; land: FillFieldKey[] };
};

export type RuleSet = {
  format: typeof FORM_RULES_FORMAT;
  portal: TransferPortal;
  version: number;
  issuedAt: string;
  expiresAt: string;
  minExtension: string;
  form: RuleSetForm;
  placeholders: string[];
  fields: RuleField[];
  fingerprints: string[];
};

/** Sunucu yanıtındaki tek portal zarfı. `sig`: base64url ECDSA P-256 SHA-256, IEEE-P1363 r||s, `signedMessage` üzerinde. */
export type RuleEnvelope = { portal: TransferPortal; rules: RuleSet; sha256: string; kid: string; sig: string };

export type RuleValidation = { ok: true; set: RuleSet } | { ok: false; reason: string };

export type ValidateOptions = {
  /** version 0 yalnız tohum için (paket içi). */
  allowSeed?: boolean;
  /** Verilirse kökteki `portal` buna eşit olmalı (zarf portalı). */
  portal?: TransferPortal;
  /** Verilirse `minExtension` bundan büyük olamaz (kurulu eklenti sürümü). */
  extensionVersion?: string;
};

const ROOT_KEYS = ["expiresAt", "fields", "fingerprints", "form", "format", "issuedAt", "minExtension", "placeholders", "portal", "version"];
const FORM_KEYS = ["maxPhotos", "recommended", "required", "titleMax"];
const RECOMMENDED_KEYS = ["land", "residential"];
const FIELD_KEYS = ["anchors", "confidence", "control", "exact", "key", "labels", "options", "state"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SEMVER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const ANCHOR_RE = /^[0-9a-f]{16}$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const PLACEHOLDER_RE = /^[a-z0-9 ]{1,40}$/;
/** Tohumun ömür sonu (yalnız version 0; tohum pakete gömülüdür, süresi dolmaz). */
export const SEED_EXPIRES_AT = "9999-12-31T00:00:00Z";

const SEED_BY_KEY = new Map(FIELD_RULES.map((r) => [r.key, r]));
/** Tohumdaki her etiket/tam ifade → sahibi anahtar (taşınamaz). */
const SEED_PHRASE_OWNER = new Map<string, FillFieldKey>();
for (const r of FIELD_RULES) for (const p of [...r.labels, ...(r.exact ?? [])]) SEED_PHRASE_OWNER.set(p, r.key);

const FILL_KEY_SET = new Set<string>(FILL_FIELD_KEYS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function exactKeys(o: Record<string, unknown>, allowed: readonly string[]): string | null {
  const keys = Object.keys(o).sort();
  for (const k of keys) if (!allowed.includes(k)) return k;
  for (const k of allowed) if (!(k in o)) return k;
  return null;
}

/** Katlanmış ifade: fold(x) === x, uzunluk sınırı ve en az bir harf. */
function isFoldedPhrase(v: unknown, min: number, max: number = RULE_LIMITS.maxText): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max && fold(v) === v && /[a-z]/.test(v);
}

function uniqueStrings(arr: readonly string[]): boolean {
  return new Set(arr).size === arr.length;
}

function keyList(v: unknown): FillFieldKey[] | null {
  if (!Array.isArray(v) || v.length > RULE_LIMITS.maxKeyList) return null;
  if (!v.every((k) => typeof k === "string" && FILL_KEY_SET.has(k))) return null;
  if (!uniqueStrings(v as string[])) return null;
  return [...(v as FillFieldKey[])];
}

const wordIn = (haystack: string, phrase: string) => ` ${haystack} `.includes(` ${phrase} `);
const polarity = (f: string): 1 | -1 | 0 => {
  // "uygun degil" önce: "uygun" kelimesini de içerir.
  if (NO_WORDS.some((w) => f === w || wordIn(f, w))) return -1;
  if (YES_WORDS.some((w) => f === w || wordIn(f, w))) return 1;
  return 0;
};

/** "1.2.3" karşılaştırması: a<b → -1, eşit 0, a>b → 1. Biçim dışı → NaN. */
export function compareVersions(a: string, b: string): number {
  if (!SEMVER_RE.test(a) || !SEMVER_RE.test(b)) return Number.NaN;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1;
  }
  return 0;
}

function validateField(raw: unknown, seed: boolean): { ok: true; field: RuleField } | { ok: false; reason: string } {
  if (!isPlainObject(raw)) return { ok: false, reason: "field_not_object" };
  const bad = exactKeys(raw, FIELD_KEYS);
  if (bad) return { ok: false, reason: `field_key_set:${bad}` };
  const key = raw.key;
  if (typeof key !== "string" || !FILL_KEY_SET.has(key)) return { ok: false, reason: "field_unknown_key" };
  const fk = key as FillFieldKey;
  const seedRule = SEED_BY_KEY.get(fk);
  if (typeof raw.control !== "string" || !(RULE_CONTROLS as readonly string[]).includes(raw.control)) return { ok: false, reason: `field_control:${fk}` };
  if (seedRule && seedRule.control !== raw.control) return { ok: false, reason: `field_control_mismatch:${fk}` };
  const { labels, exact, anchors, options } = raw;
  if (!Array.isArray(labels) || labels.length > RULE_LIMITS.maxLabels) return { ok: false, reason: `field_labels:${fk}` };
  if (!labels.every((l) => isFoldedPhrase(l, RULE_LIMITS.minLabel)) || !uniqueStrings(labels as string[])) return { ok: false, reason: `field_label_text:${fk}` };
  if (!Array.isArray(exact) || exact.length > RULE_LIMITS.maxExact) return { ok: false, reason: `field_exact:${fk}` };
  if (!exact.every((l) => isFoldedPhrase(l, RULE_LIMITS.minLabel)) || !uniqueStrings(exact as string[])) return { ok: false, reason: `field_exact_text:${fk}` };
  if (!Array.isArray(anchors) || anchors.length > RULE_LIMITS.maxAnchors) return { ok: false, reason: `field_anchors:${fk}` };
  if (!anchors.every((a) => typeof a === "string" && ANCHOR_RE.test(a)) || !uniqueStrings(anchors as string[])) return { ok: false, reason: `field_anchor_text:${fk}` };
  if (!isPlainObject(options)) return { ok: false, reason: `field_options:${fk}` };
  const optionKeys = Object.keys(options);
  if (optionKeys.length > RULE_LIMITS.maxOptionKeys) return { ok: false, reason: `field_options_count:${fk}` };
  const outOptions: Record<string, string[]> = {};
  for (const ok of optionKeys) {
    if (typeof ok !== "string" || ok.length < 1 || ok.length > RULE_LIMITS.maxText || fold(ok) !== ok) return { ok: false, reason: `field_option_key:${fk}` };
    const aliases = options[ok];
    if (!Array.isArray(aliases) || aliases.length < 1 || aliases.length > RULE_LIMITS.maxOptionAliases) return { ok: false, reason: `field_option_aliases:${fk}` };
    if (!aliases.every((a) => typeof a === "string" && a.length >= 1 && a.length <= RULE_LIMITS.maxText && fold(a) === a) || !uniqueStrings(aliases as string[])) {
      return { ok: false, reason: `field_option_alias_text:${fk}` };
    }
    const pk = polarity(ok);
    for (const a of aliases as string[]) {
      const pa = polarity(a);
      if (pk !== 0 && pa !== 0 && pk !== pa) return { ok: false, reason: `field_option_polarity:${fk}` };
    }
    outOptions[ok] = [...(aliases as string[])];
  }
  if (typeof raw.state !== "string" || !(RULE_FIELD_STATES as readonly string[]).includes(raw.state)) return { ok: false, reason: `field_state:${fk}` };
  const conf = raw.confidence;
  if (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 1) return { ok: false, reason: `field_confidence:${fk}` };

  if (!seed && RISKY_FIELD_KEYS.includes(fk) && seedRule) {
    const seedLabels = new Set(seedRule.labels);
    const seedExact = new Set(seedRule.exact ?? []);
    if (!(labels as string[]).every((l) => seedLabels.has(l)) || !(exact as string[]).every((l) => seedExact.has(l))) return { ok: false, reason: `field_risky_labels:${fk}` };
    if (anchors.length > 0 || optionKeys.length > 0) return { ok: false, reason: `field_risky_data:${fk}` };
  }
  return {
    ok: true,
    field: {
      key: fk,
      control: raw.control as FillControl,
      labels: [...(labels as string[])],
      exact: [...(exact as string[])],
      anchors: [...(anchors as string[])],
      options: outOptions,
      state: raw.state as RuleFieldState,
      confidence: conf,
    },
  };
}

/**
 * Kural setini KATI doğrular (biçim B). `raw` ham JSON metni ya da ayrıştırılmış nesne olabilir; metinse önce bayt sınırı.
 * Dönen `set` yeni, temiz bir kopyadır (girdiye referans tutmaz).
 */
export function validateRuleSet(raw: unknown, opts: ValidateOptions = {}): RuleValidation {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (utf8Length(raw) > RULE_LIMITS.maxBytes) return { ok: false, reason: "too_large" };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "parse" };
    }
  }
  if (!isPlainObject(value)) return { ok: false, reason: "not_object" };
  let canon: string;
  try {
    canon = canonicalJson(value);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (utf8Length(canon) > RULE_LIMITS.maxBytes) return { ok: false, reason: "too_large" };
  const bad = exactKeys(value, ROOT_KEYS);
  if (bad) return { ok: false, reason: `root_key_set:${bad}` };
  if (value.format !== FORM_RULES_FORMAT) return { ok: false, reason: "format" };
  const portal = value.portal;
  if (typeof portal !== "string" || !(TRANSFER_PORTALS as readonly string[]).includes(portal)) return { ok: false, reason: "portal" };
  if (opts.portal && portal !== opts.portal) return { ok: false, reason: "portal_mismatch" };
  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0 || version > RULE_LIMITS.maxVersion) return { ok: false, reason: "version" };
  const seed = version === 0;
  if (seed && !opts.allowSeed) return { ok: false, reason: "seed_version" };
  const { issuedAt, expiresAt } = value;
  if (typeof issuedAt !== "string" || !ISO_RE.test(issuedAt) || !Number.isFinite(Date.parse(issuedAt))) return { ok: false, reason: "issued_at" };
  if (typeof expiresAt !== "string" || !ISO_RE.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt))) return { ok: false, reason: "expires_at" };
  const ttlMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (ttlMs <= 0) return { ok: false, reason: "expires_at" };
  if (!seed && ttlMs > RULE_LIMITS.maxTtlDays * 86_400_000) return { ok: false, reason: "ttl_too_long" };
  const minExtension = value.minExtension;
  if (typeof minExtension !== "string" || !SEMVER_RE.test(minExtension)) return { ok: false, reason: "min_extension" };
  if (opts.extensionVersion && !(compareVersions(minExtension, opts.extensionVersion) <= 0)) return { ok: false, reason: "min_extension_newer" };

  const form = value.form;
  if (!isPlainObject(form)) return { ok: false, reason: "form" };
  const badForm = exactKeys(form, FORM_KEYS);
  if (badForm) return { ok: false, reason: `form_key_set:${badForm}` };
  if (typeof form.maxPhotos !== "number" || !Number.isInteger(form.maxPhotos) || form.maxPhotos < 1 || form.maxPhotos > 50) return { ok: false, reason: "form_max_photos" };
  if (typeof form.titleMax !== "number" || !Number.isInteger(form.titleMax) || form.titleMax < 20 || form.titleMax > 200) return { ok: false, reason: "form_title_max" };
  const required = keyList(form.required);
  if (!required) return { ok: false, reason: "form_required" };
  const rec = form.recommended;
  if (!isPlainObject(rec) || exactKeys(rec, RECOMMENDED_KEYS)) return { ok: false, reason: "form_recommended" };
  const residential = keyList(rec.residential);
  const land = keyList(rec.land);
  if (!residential || !land) return { ok: false, reason: "form_recommended" };

  const placeholders = value.placeholders;
  if (!Array.isArray(placeholders) || placeholders.length > RULE_LIMITS.maxPlaceholders) return { ok: false, reason: "placeholders" };
  if (!placeholders.every((p) => typeof p === "string" && PLACEHOLDER_RE.test(p) && fold(p) === p) || !uniqueStrings(placeholders as string[])) {
    return { ok: false, reason: "placeholder_text" };
  }

  const fp = value.fingerprints;
  if (!Array.isArray(fp) || fp.length > RULE_LIMITS.maxFingerprints) return { ok: false, reason: "fingerprints" };
  if (!fp.every((f) => typeof f === "string" && FINGERPRINT_RE.test(f)) || !uniqueStrings(fp as string[])) return { ok: false, reason: "fingerprint_text" };

  const rawFields = value.fields;
  if (!Array.isArray(rawFields) || rawFields.length > RULE_LIMITS.maxFields) return { ok: false, reason: "fields" };
  const fields: RuleField[] = [];
  const seenKeys = new Set<string>();
  const phraseOwner = new Map<string, FillFieldKey>();
  for (const rf of rawFields) {
    const r = validateField(rf, seed);
    if (!r.ok) return r;
    if (seenKeys.has(r.field.key)) return { ok: false, reason: `field_duplicate:${r.field.key}` };
    seenKeys.add(r.field.key);
    for (const p of [...r.field.labels, ...r.field.exact]) {
      const owner = phraseOwner.get(p);
      if (owner && owner !== r.field.key) return { ok: false, reason: `label_shared:${p}` };
      phraseOwner.set(p, r.field.key);
      const seedOwner = SEED_PHRASE_OWNER.get(p);
      if (seedOwner && seedOwner !== r.field.key) return { ok: false, reason: `label_moved:${p}` };
    }
    fields.push(r.field);
  }

  return {
    ok: true,
    set: {
      format: FORM_RULES_FORMAT,
      portal: portal as TransferPortal,
      version,
      issuedAt,
      expiresAt,
      minExtension,
      form: { maxPhotos: form.maxPhotos, titleMax: form.titleMax, required, recommended: { residential, land } },
      placeholders: [...(placeholders as string[])],
      fields,
      fingerprints: [...(fp as string[])],
    },
  };
}

/** Süresi doldu mu (tohum hiç dolmaz)? Süresi dolan uzak set yerine tohum kullanılır (K3). */
export function isRuleSetExpired(set: Pick<RuleSet, "version" | "expiresAt">, nowMs: number): boolean {
  if (set.version === 0) return false;
  const t = Date.parse(set.expiresAt);
  return !Number.isFinite(t) || t <= nowMs;
}

/**
 * Kanonik JSON: nesne anahtarları sözlük sırasıyla (UTF-16 kod birimi), boşluksuz; dizi sırası korunur. Sayı yazımı
 * JSON.stringify ile aynı (Postgres jsonb'den dönen `0.620` ayrıştırıldıktan sonra `0.62` olur → sha yalnız TS'te). Sonlu
 * olmayan sayı, undefined, fonksiyon → hata.
 */
export function canonicalJson(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("canonicalJson: sonlu olmayan sayı");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x)).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys
      .map((k) => {
        if (o[k] === undefined) throw new Error("canonicalJson: undefined değer");
        return `${JSON.stringify(k)}:${canonicalJson(o[k])}`;
      })
      .join(",")}}`;
  }
  throw new Error("canonicalJson: desteklenmeyen tür");
}

/** İmzalanan dize. */
export function signedMessage(portal: string, version: number, sha: string): string {
  return `es-rules|${FORM_RULES_ENGINE}|${portal}|${version}|${sha}`;
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** sha256(canonicalJson(set)) — 64 hex. WebCrypto (eklenti ve Node 20+ ortak). */
export async function ruleSetSha256(set: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(set));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
