/**
 * Yetkilendirme denetim günlüğü filtre kontratı (URL ↔ sunucu sorgusu ↔ CSV) — saf.
 * Ekran ve CSV aynı normalleştirici + uygulayıcıyı kullanır; parametreler yalnız bilinen değerlerle geçer.
 */
import { AUDIT_CHANGE_TYPES } from "./admin-rules";

export type AccessAuditFilters = {
  /** Yetkisi değişen kullanıcı (uuid). */
  kullanici: string;
  /** Değişikliği yapan (uuid). */
  yapan: string;
  /** change_type. */
  tur: string;
  /** YYYY-MM-DD */
  from: string;
  to: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const uuid = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : "");
const day = (v: unknown) => (typeof v === "string" && DAY_RE.test(v) ? v : "");

export function normalizeAccessAuditFilters(raw: Partial<Record<keyof AccessAuditFilters, unknown>> | undefined): AccessAuditFilters {
  return {
    kullanici: uuid(raw?.kullanici),
    yapan: uuid(raw?.yapan),
    tur: typeof raw?.tur === "string" && AUDIT_CHANGE_TYPES.includes(raw.tur) ? raw.tur : "",
    from: day(raw?.from),
    to: day(raw?.to),
  };
}

export function hasAccessAuditFilter(f: AccessAuditFilters): boolean {
  return Object.values(f).some(Boolean);
}

type FilterQuery = { eq(c: string, v: string): FilterQuery; gte(c: string, v: string): FilterQuery; lt(c: string, v: string): FilterQuery };

/**
 * `to` günü DAHİL (ertesi gün 00:00'dan küçük). Tarihler ISO gün anahtarıdır (denetim sayfasıyla aynı kabul).
 * Yapısal tip: Supabase sorgu kurucusunun derin generiğine girmez (TS2589), zincir türü korunur.
 */
export function applyAccessAuditFilters<Q>(query: Q, f: AccessAuditFilters): Q {
  let q = query as unknown as FilterQuery;
  if (f.kullanici) q = q.eq("user_id", f.kullanici);
  if (f.yapan) q = q.eq("created_by", f.yapan);
  if (f.tur) q = q.eq("change_type", f.tur);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00.000Z`);
  if (f.to) {
    const next = new Date(`${f.to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    q = q.lt("created_at", next.toISOString());
  }
  return q as unknown as Q;
}

/** Sayfa/CSV bağlantıları için URLSearchParams (boşlar düşer, `sayfa` 1 ise yazılmaz). */
export function accessAuditFiltersToParams(f: AccessAuditFilters, sayfa?: number): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("sekme", "gunluk");
  for (const [k, v] of Object.entries(f)) if (v) sp.set(k, v);
  if (sayfa && sayfa > 1) sp.set("sayfa", String(sayfa));
  return sp;
}
