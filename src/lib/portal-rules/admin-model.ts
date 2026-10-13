import { FIELD_RULES, TRANSFER_PORTALS, fold, type TransferPortal } from "@/lib/portal-transfer/rules";

/**
 * Yönetim > Sistem > Portal kuralları sekmesinin SAF modeli (sunucu ve istemci ortak; DB/IO yok, testli).
 * Güven kovası, durum/kaynak etiketleri, change_summary → okunur fark satırları, "form değişti" metni ve
 * `pt_rules_admin_overview` yanıtının savunmacı ayrıştırılması burada. Kiracı adı bu modelde YOK (yalnız uygunluk paneli).
 */

export const PORTAL_RULES_TAB = "portal-kurallari";
export const PORTAL_RULES_BASE = "/admin/sistem";

export const PORTAL_LABELS: Record<TransferPortal, string> = {
  sahibinden: "sahibinden.com",
  hepsiemlak: "Hepsiemlak",
  emlakjet: "Emlakjet",
};

/** URL'deki `?portal=` değeri; bilinmeyen/boş → sahibinden. */
export function parsePortal(raw: string | null | undefined): TransferPortal {
  return (TRANSFER_PORTALS as readonly string[]).includes(raw ?? "") ? (raw as TransferPortal) : "sahibinden";
}

export type PortalRulesView =
  | { kind: "genel" }
  | { kind: "oneriler" }
  | { kind: "uyarilar" }
  | { kind: "surumler" }
  | { kind: "uygunluk" }
  | { kind: "alan"; key: string }
  | { kind: "kanit"; id: string }
  | { kind: "form"; fingerprint: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FP_RE = /^[0-9a-f]{64}$/;
const KEY_RE = /^[a-z0-9_]{1,40}$/;

/** `?gorunum=` filtresi (iki yönlü filtre sözleşmesi): oneriler | uyarilar | surumler | uygunluk | alan:<key> | kanit:<uuid> | form:<64hex>. */
export function parseView(raw: string | null | undefined): PortalRulesView {
  const v = (raw ?? "").trim();
  if (v === "oneriler" || v === "uyarilar" || v === "surumler" || v === "uygunluk") return { kind: v };
  const [head, arg = ""] = v.split(":", 2);
  if (head === "alan" && KEY_RE.test(arg)) return { kind: "alan", key: arg };
  if (head === "kanit" && UUID_RE.test(arg)) return { kind: "kanit", id: arg.toLowerCase() };
  if (head === "form" && FP_RE.test(arg)) return { kind: "form", fingerprint: arg };
  return { kind: "genel" };
}

/** Sekme içi derin bağlantı (her sayı bunu kullanır). */
export function portalRulesHref(portal: TransferPortal, view?: string | null): string {
  const q = new URLSearchParams({ sekme: PORTAL_RULES_TAB, portal });
  if (view) q.set("gorunum", view);
  return `${PORTAL_RULES_BASE}?${q.toString()}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Güven, durum ve kaynak etiketleri

export type ConfidenceBucket = "yuksek" | "orta" | "dusuk";

/** Wilson alt sınırı kovası: ≥0,5 yüksek, 0,3–0,5 orta, altı düşük. Geçersiz değer düşük sayılır. */
export function confidenceBucket(value: number | null | undefined): ConfidenceBucket {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (v >= 0.5) return "yuksek";
  if (v >= 0.3) return "orta";
  return "dusuk";
}

export const CONFIDENCE_LABELS: Record<ConfidenceBucket, string> = { yuksek: "Yüksek", orta: "Orta", dusuk: "Düşük" };
export const CONFIDENCE_TONES: Record<ConfidenceBucket, "success" | "warning" | "neutral"> = {
  yuksek: "success",
  orta: "warning",
  dusuk: "neutral",
};

/** 0,62 → "0,62" (Türkçe ondalık). */
export function formatConfidence(value: number | null | undefined): string {
  const v = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type FieldState = "verified" | "unverified" | "degraded" | "disabled";

export const FIELD_STATE_LABELS: Record<FieldState, string> = {
  verified: "Doğrulanmış",
  unverified: "Doğrulanmamış",
  degraded: "Kontrol edin",
  disabled: "Kapalı (elle)",
};
export const FIELD_STATE_TONES: Record<FieldState, "success" | "info" | "warning" | "danger"> = {
  verified: "success",
  unverified: "info",
  degraded: "warning",
  disabled: "danger",
};

export function fieldStateOf(raw: unknown): FieldState {
  return raw === "verified" || raw === "degraded" || raw === "disabled" ? raw : "unverified";
}

const FIELD_LABEL_BY_KEY = new Map<string, string>(FIELD_RULES.map((r) => [r.key, r.label] as const));

/** EmlakSoft alan anahtarının görünen adı (bilinmeyen anahtar olduğu gibi). */
export function fieldLabel(key: string | null | undefined): string {
  if (!key) return "Eşleşmemiş alan";
  return FIELD_LABEL_BY_KEY.get(key) ?? key;
}

export type ProposalSource = "corrections" | "unmatched" | "ai" | "staff";

/** Kaynak rozeti: düzeltme / eşleşmeyen / AI-doğrulanmamış / personel. */
export function sourceBadge(source: string | null | undefined, aiUnverified?: boolean | null): { label: string; tone: "info" | "warning" | "neutral" | "success" } {
  if (source === "ai") return { label: aiUnverified === false ? "AI" : "AI · doğrulanmamış", tone: "warning" };
  if (source === "corrections") return { label: "Düzeltme", tone: "info" };
  if (source === "unmatched") return { label: "Eşleşmeyen", tone: "neutral" };
  if (source === "staff") return { label: "Personel", tone: "success" };
  return { label: "Bilinmeyen kaynak", tone: "neutral" };
}

export const PROPOSAL_KIND_LABELS: Record<string, string> = {
  label_map: "Etiket eşlemesi",
  option_map: "Seçenek eşlemesi",
  field_demote: "Alanı gerilet",
  field_disable: "Alanı kapat",
  new_field: "Yeni alan",
  form_meta: "Form ayarı",
};

export const PROPOSAL_STATE_LABELS: Record<string, string> = {
  collecting: "Kanıt toplanıyor",
  ready: "Onay bekliyor",
  auto_approved: "Otomatik doğrulandı",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  superseded: "Yerini aldı",
  expired: "Süresi doldu",
};

export const RULE_SET_KIND_LABELS: Record<string, string> = {
  seed: "Tohum",
  auto: "Otomatik",
  staff: "Personel onayı",
  rollback: "Geri alma",
};

export const RULE_SET_STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  published: "Yayında",
  superseded: "Eski",
  rejected: "Reddedildi",
};

/**
 * Tek ofisten gelen metin (Y2): etiket/seçenek/yeni alan önerisi `support_tenants < 2` iken personel onayında
 * "kişisel veri içermiyor" teyidi zorunludur.
 */
export function needsPiiAck(kind: string | null | undefined, supportTenants: number | null | undefined): boolean {
  const textual = kind === "label_map" || kind === "option_map" || kind === "new_field";
  return textual && (supportTenants ?? 0) < 2;
}

// ---------------------------------------------------------------------------------------------------------------------
// change_summary → okunur fark satırları

const CHANGE_VERBS: Record<string, string> = {
  label_map: "etiket eklendi",
  label_add: "etiket eklendi",
  anchor_add: "alan imzası eklendi",
  option_map: "seçenek eşlemesi eklendi",
  option_add: "seçenek eşlemesi eklendi",
  field_demote: "geriletildi (kontrol edin)",
  field_disable: "kapatıldı (elle doldurulur)",
  new_field: "yeni alan olarak eklendi (doğrulanmamış)",
  form_meta: "form ayarı değişti",
  state: "durumu değişti",
};

function textOf(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(textOf).filter((x): x is string => !!x);
    return parts.length ? parts.slice(0, 6).join(", ") : null;
  }
  return null;
}

function lineOf(entry: unknown): string | null {
  if (typeof entry === "string") return entry.trim() ? entry.trim().slice(0, 160) : null;
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const key = (typeof e.field_key === "string" && e.field_key) || (typeof e.key === "string" && e.key) || (typeof e.field === "string" && e.field) || null;
  const kind = typeof e.kind === "string" ? e.kind : typeof e.op === "string" ? e.op : null;
  const verb = kind ? (CHANGE_VERBS[kind] ?? kind.replace(/_/g, " ")) : "değişti";
  const detail = textOf(e.detail) ?? textOf(e.added) ?? textOf(e.label) ?? textOf(e.option) ?? textOf(e.to) ?? null;
  const subject = key ? fieldLabel(key) : kind === "form_meta" ? "Form" : "Kural seti";
  return `${subject}: ${verb}${detail ? ` (${detail})` : ""}`;
}

/**
 * Sürümün `change_summary` jsonb'sini okunur satırlara çevirir. Biçim esnek okunur: dizi, `{changes:[...]}`,
 * tohum (`{seed:true}`) ve geri alma (`{rolled_back_to|rolls_back_to: n}`). Tanınmayan biçim boş liste (uydurma yok).
 */
export function changeSummaryLines(summary: unknown, opts?: { rollsBackTo?: number | null; kind?: string | null }): string[] {
  const out: string[] = [];
  const rb = opts?.rollsBackTo ?? null;
  if (opts?.kind === "rollback" || rb != null) {
    const s = summary && typeof summary === "object" && !Array.isArray(summary) ? (summary as Record<string, unknown>) : {};
    const to = rb ?? (typeof s.rolled_back_to === "number" ? s.rolled_back_to : typeof s.rolls_back_to === "number" ? s.rolls_back_to : null);
    out.push(to != null ? `Sürüm ${to} içeriğine geri dönüldü` : "Önceki bir sürümün içeriğine geri dönüldü");
    return out;
  }
  if (opts?.kind === "seed") {
    out.push("Paket içi varsayılan kurallar (tohum) yayınlandı");
    return out;
  }
  const list = Array.isArray(summary)
    ? summary
    : summary && typeof summary === "object" && Array.isArray((summary as { changes?: unknown }).changes)
      ? ((summary as { changes: unknown[] }).changes)
      : [];
  for (const entry of list.slice(0, 20)) {
    const line = lineOf(entry);
    if (line) out.push(line);
  }
  if (list.length > 20) out.push(`… ve ${list.length - 20} değişiklik daha`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Form değişti uyarısı

export type FormAlert = {
  fingerprint: string;
  alertState: "warning" | "info";
  fieldCount: number;
  tenantsN: number;
  jaccardPrev: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  status: string | null;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** portal_form_versions satırı → uyarı (alert_state warning/info değilse null). */
export function toFormAlert(row: Record<string, unknown>): FormAlert | null {
  const state = row.alert_state;
  if (state !== "warning" && state !== "info") return null;
  const fp = typeof row.fingerprint === "string" ? row.fingerprint : "";
  if (!fp) return null;
  return {
    fingerprint: fp,
    alertState: state,
    fieldCount: num(row.field_count) ?? 0,
    tenantsN: num(row.tenants_n) ?? 0,
    jaccardPrev: num(row.jaccard_prev),
    firstSeen: typeof row.first_seen === "string" ? row.first_seen : null,
    lastSeen: typeof row.last_seen === "string" ? row.last_seen : null,
    status: typeof row.status === "string" ? row.status : null,
  };
}

/** "Form değişti" metni: uyarı = ≥2 ofiste yeni yapı + düşük benzerlik; bilgi = tek ofis gözlemi. */
export function formChangedText(portal: TransferPortal, alert: Pick<FormAlert, "alertState" | "tenantsN" | "jaccardPrev" | "fieldCount">): string {
  const name = PORTAL_LABELS[portal];
  const sim = alert.jaccardPrev != null ? ` · önceki yapıyla benzerlik %${Math.round(alert.jaccardPrev * 100)}` : "";
  if (alert.alertState === "warning") {
    return `${name} ilan formu değişti: yeni yapı ${alert.tenantsN} ofiste görüldü (${alert.fieldCount} alan${sim}). Eşleşmeyen alanları kontrol edin.`;
  }
  return `${name} ilan formunda olası değişiklik: yeni yapı şimdilik ${alert.tenantsN} ofiste görüldü (${alert.fieldCount} alan${sim}).`;
}

/** Parmak izinin kısa gösterimi (ilk 12 hex). */
export function shortFingerprint(fp: string): string {
  return fp.slice(0, 12);
}

// ---------------------------------------------------------------------------------------------------------------------
// pt_rules_admin_overview → alan başına toplu sayılar (kiracı adı yok)

export type FieldOverview = {
  key: string;
  supportTenants: number;
  contradictTenants: number;
  /** Son 14 günde başarı oranı 0..1; deneme yoksa null. */
  success14d: number | null;
  attempts14d: number;
  lastSeen: string | null;
};

export type Overview = {
  fields: Map<string, FieldOverview>;
  pendingProposals: number | null;
  formAlerts: number | null;
  eligibleTenants: number | null;
};

function ratio(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  const r = n > 1 ? n / 100 : n;
  return r >= 0 && r <= 1 ? r : null;
}

/**
 * RPC yanıtını savunmacı okur: `{fields:[...]}` ya da düz dizi; sayı alanları için birkaç yaygın ad kabul edilir.
 * Tanınmayan biçim boş özet döner (sayı uydurulmaz → tabloda "—").
 */
export function normalizeOverview(raw: unknown): Overview {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(root.fields) ? (root.fields as unknown[]) : [];
  const fields = new Map<string, FieldOverview>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const key = typeof r.field_key === "string" ? r.field_key : typeof r.key === "string" ? r.key : null;
    if (!key) continue;
    const ok = num(r.ok_14d) ?? num(r.success_n_14d);
    const attempts = num(r.attempts_14d) ?? num(r.sessions_14d) ?? num(r.total_14d) ?? 0;
    const success = ratio(r.success_14d) ?? ratio(r.success_rate_14d) ?? (ok != null && attempts > 0 ? ok / attempts : null);
    fields.set(key, {
      key,
      supportTenants: num(r.support_tenants) ?? 0,
      contradictTenants: num(r.contradict_tenants) ?? 0,
      success14d: attempts > 0 || success != null ? success : null,
      attempts14d: attempts,
      lastSeen: typeof r.last_seen === "string" ? r.last_seen : null,
    });
  }
  return {
    fields,
    pendingProposals: num(root.pending_proposals) ?? num(root.ready_proposals),
    formAlerts: num(root.form_alerts),
    eligibleTenants: num(root.eligible_tenants),
  };
}

/** 0,734 → "%73"; null → "—". */
export function formatPercent(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? `%${Math.round(v * 100)}` : "—";
}

// ---------------------------------------------------------------------------------------------------------------------
// Ofis uygunluğu

/** Varsayılan öneri: E2E Test Ofis, Demo Emlak Ofisi ve "admin" kiracısı öğrenmeden dışlanır. */
export function suggestedExclusion(tenant: { name?: string | null; slug?: string | null }): string | null {
  const n = fold(tenant.name ?? "");
  const s = fold(tenant.slug ?? "");
  if (n === "e2e test ofis" || s.startsWith("e2e")) return "Test ofisi (E2E)";
  if (n === "demo emlak ofisi" || s === "demo-ofis" || s === "demo ofis") return "Demo ofisi";
  if (n === "admin" || s === "admin") return "Platform yönetim kiracısı";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Yayın içeriği

/**
 * Yayınlanacak içerik: tabandaki kural seti + yeni sürüm numarası + yayın anı. Taban değiştirilmez (yeni nesne).
 * Sürüm = portaldaki en büyük sürüm + 1 (SQL de aynı kuralı denetler).
 */
export function withVersion<T extends Record<string, unknown>>(base: T, version: number, issuedAtIso: string): T & { version: number; issuedAt: string } {
  return { ...base, version, issuedAt: issuedAtIso };
}
