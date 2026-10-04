import { HIGH_RISK_ACTIONS, MED_RISK_ACTIONS, actionLabel, type RiskLevel } from "@/lib/audit-labels";

/**
 * Denetim kaydı filtreleri — sayfa ve CSV AYNI süzgeci kullanır (URL ↔ sunucu sorgusu ↔ dışa aktarma).
 */
export type AuditFilters = {
  from: string;
  to: string;
  aktor: string;
  risk: RiskLevel | "";
  /** İşlem türü: tam aksiyon kodu (örn. "customer.delete"). */
  tur: string;
  /** Serbest metin: işlem etiketi/kodu veya kayıt türü. */
  ara: string;
};

export const EMPTY_AUDIT_FILTERS: AuditFilters = { from: "", to: "", aktor: "", risk: "", tur: "", ara: "" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_CODE_RE = /^[a-z_]+(\.[a-z_]+)*$/;

function safeDate(value: unknown) {
  const v = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

/** Ham URL/form girdisini güvenli filtreye çevirir (geçersiz değer boşa düşer). */
export function normalizeAuditFilters(raw: Partial<Record<keyof AuditFilters, unknown>>): AuditFilters {
  const aktor = typeof raw.aktor === "string" ? raw.aktor.trim() : "";
  const tur = typeof raw.tur === "string" ? raw.tur.trim() : "";
  const ara = typeof raw.ara === "string" ? raw.ara.trim().slice(0, 60) : "";
  return {
    from: safeDate(raw.from),
    to: safeDate(raw.to),
    aktor: UUID_RE.test(aktor) ? aktor : "",
    risk: raw.risk === "yuksek" || raw.risk === "orta" ? raw.risk : "",
    tur: ACTION_CODE_RE.test(tur) ? tur : "",
    ara: ara.replace(/[^\p{L}\p{N} ._-]/gu, ""),
  };
}

export function hasAuditFilter(f: AuditFilters) {
  return Boolean(f.from || f.to || f.aktor || f.risk || f.tur || f.ara);
}

function trLower(s: string) {
  return s.toLocaleLowerCase("tr-TR");
}

/** Metin aramasına uyan aksiyon kodları (etiket veya kod içinde geçer). */
export function actionCodesMatching(ara: string): string[] {
  const q = trLower(ara);
  if (!q) return [];
  return Object.entries(actionLabel)
    .filter(([code, label]) => trLower(label).includes(q) || code.includes(q))
    .map(([code]) => code);
}

type Filterable<Q> = {
  gte(col: string, v: string): Q;
  lte(col: string, v: string): Q;
  eq(col: string, v: string): Q;
  in(col: string, v: string[]): Q;
  or(expr: string): Q;
};

/** Filtreleri Supabase sorgusuna uygular (sayfa ve CSV ortak). */
export function applyAuditFilters<Q extends Filterable<Q>>(query: Q, f: AuditFilters): Q {
  let q = query;
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59.999`);
  if (f.aktor) q = q.eq("actor_id", f.aktor);
  if (f.tur) q = q.eq("action", f.tur);
  if (f.risk === "yuksek") q = q.in("action", [...HIGH_RISK_ACTIONS]);
  if (f.risk === "orta") q = q.in("action", [...MED_RISK_ACTIONS]);
  if (f.ara) {
    const codes = actionCodesMatching(f.ara);
    const parts = [`entity_type.ilike.*${f.ara.replace(/ /g, "*")}*`];
    if (codes.length) parts.push(`action.in.(${codes.join(",")})`);
    q = q.or(parts.join(","));
  }
  return q;
}

/** Filtreleri URL sorgu dizesine çevirir (boşlar atlanır). */
export function auditFiltersToParams(f: AuditFilters, page = 1): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (f.aktor) sp.set("aktor", f.aktor);
  if (f.risk) sp.set("risk", f.risk);
  if (f.tur) sp.set("tur", f.tur);
  if (f.ara) sp.set("ara", f.ara);
  if (page > 1) sp.set("sayfa", String(page));
  return sp;
}
