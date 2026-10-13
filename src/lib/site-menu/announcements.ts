import type { AnnouncementPathMode } from "./schema-core";

/**
 * Çoklu duyuru şeridi: SAF seçim ve yardımcılar (zod'suz; sunucu, istemci bileşeni, statik ana sayfa çalışma zamanı ve
 * admin önizlemesi aynı kodu kullanır). Tarihler Türkiye günüyle değerlendirilir (UTC+3, yaz saati yok): başlangıç
 * gününün 00:00'ından bitiş gününün 23:59:59'una kadar. Saat dışarıdan verilir (`nowMs`, çağıran `src/lib/clock` kullanır).
 */

/** Seçime giren alanlar (yayın görünümü `PublicAnnouncement` bunları taşır). `id` kapatma anahtarıdır. */
export type AnnouncementTarget = {
  id: string;
  startsAtMs: number | null;
  endsAtMs: number | null;
  pathMode: AnnouncementPathMode;
  pathPrefix: string;
  priority: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` gününün Türkiye saatiyle başı (00:00). Boş/geçersizse null. */
export function startOfDayTrMs(day: string): number | null {
  if (!DAY_RE.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00+03:00`);
  return Number.isNaN(t) ? null : t;
}

/** `YYYY-MM-DD` gününün Türkiye saatiyle sonu (23:59:59). Boş/geçersizse null. */
export function endOfDayTrMs(day: string): number | null {
  if (!day) return null;
  const t = Date.parse(`${day}T23:59:59+03:00`);
  return Number.isNaN(t) ? null : t;
}

/** Yol karşılaştırması için sondaki eğik çizgi, sorgu ve bölüm atılır (`/fiyatlar/?a#b` → `/fiyatlar`). */
export function normalizePath(path: string): string {
  const p = path.split(/[?#]/)[0] || "/";
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

export function matchesPath(a: Pick<AnnouncementTarget, "pathMode" | "pathPrefix">, path: string): boolean {
  if (a.pathMode === "all") return true;
  const p = normalizePath(path);
  if (a.pathMode === "home") return p === "/";
  const prefix = normalizePath(a.pathPrefix.trim());
  if (!prefix.startsWith("/")) return false;
  if (prefix === "/") return true;
  return p === prefix || p.startsWith(`${prefix}/`);
}

export function isActiveAt(a: Pick<AnnouncementTarget, "startsAtMs" | "endsAtMs">, nowMs: number): boolean {
  if (a.startsAtMs !== null && nowMs < a.startsAtMs) return false;
  if (a.endsAtMs !== null && nowMs > a.endsAtMs) return false;
  return true;
}

/**
 * Gösterilecek TEK duyuru: aktif (tarih), yola uyan, kapatılmamış kayıtlar içinde en yüksek öncelikli olan.
 * Eşit öncelikte listedeki sıra (editördeki sıralama) belirler. Uygun kayıt yoksa null.
 */
export function pickAnnouncement<T extends AnnouncementTarget>(
  list: readonly T[],
  path: string,
  nowMs: number,
  dismissedIds: ReadonlySet<string> | readonly string[] = [],
): T | null {
  const dismissed = dismissedIds instanceof Set ? dismissedIds : new Set(dismissedIds as readonly string[]);
  let best: T | null = null;
  for (const a of list) {
    if (dismissed.has(a.id) || !isActiveAt(a, nowMs) || !matchesPath(a, path)) continue;
    if (!best || a.priority > best.priority) best = a;
  }
  return best;
}

/** Kapatılan duyuru anahtarları tarayıcıda tek değerde, boşlukla ayrılmış tutulur (eski tekil anahtar da okunur). */
export const ANNOUNCEMENT_DISMISS_KEY = "mk-ann-off";
const MAX_DISMISSED = 8;

export function parseDismissed(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/\s+/).filter(Boolean).slice(-MAX_DISMISSED);
}

export function addDismissed(raw: string | null | undefined, key: string): string {
  const list = parseDismissed(raw).filter((k) => k !== key);
  return [...list, key].slice(-MAX_DISMISSED).join(" ");
}

/**
 * Kapatma anahtarı: duyuru kimliği + içerik özeti. Metin, bağlantı ya da tarih değişince anahtar değişir ve daha önce
 * kapatan ziyaretçi yeni içeriği yeniden görür (kimlik bazlı; içerik aynı kaldıkça kapalı kalır). FNV-1a 32 bit.
 */
export function announcementKey(id: string, parts: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${id}-${h.toString(36)}`;
}

/** UTM/plan değeri: harf, rakam, alt çizgi, nokta, tire (bağlantı doğrulayıcısının sorgu kuralına uyar). */
export function utmValue(v: string): string {
  return v
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * UTM oluşturucu: verilen bağlantıya `plan`, `utm_source`, `utm_campaign` ekler/günceller (boş değer parametreyi siler).
 * Bölüm (#...) korunur. Yalnız site yolu ya da http(s) adresi için; diğerleri aynen döner.
 */
/** Bağlantıdaki mevcut plan/utm_source/utm_campaign değerleri (UTM oluşturucu açılırken alanları doldurmak için; yoksa ""). */
export function readUtm(href: string): { plan: string; source: string; campaign: string } {
  const raw = href.trim();
  const hashAt = raw.indexOf("#");
  const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const qAt = beforeHash.indexOf("?");
  const get = new Map<string, string>();
  if (qAt !== -1) {
    for (const kv of beforeHash.slice(qAt + 1).split("&")) {
      if (!kv) continue;
      const i = kv.indexOf("=");
      const k = i === -1 ? kv : kv.slice(0, i);
      if (!get.has(k)) get.set(k, i === -1 ? "" : kv.slice(i + 1));
    }
  }
  return { plan: get.get("plan") ?? "", source: get.get("utm_source") ?? "", campaign: get.get("utm_campaign") ?? "" };
}

export function withUtm(href: string, p: { plan?: string; source?: string; campaign?: string }): string {
  const raw = href.trim() || "/";
  if (!raw.startsWith("/") && !/^https?:\/\//i.test(raw)) return raw;
  const hashAt = raw.indexOf("#");
  const hash = hashAt === -1 ? "" : raw.slice(hashAt);
  const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const qAt = beforeHash.indexOf("?");
  const base = qAt === -1 ? beforeHash : beforeHash.slice(0, qAt);
  const pairs = (qAt === -1 ? "" : beforeHash.slice(qAt + 1))
    .split("&")
    .filter(Boolean)
    .map((kv) => {
      const i = kv.indexOf("=");
      return i === -1 ? ([kv, ""] as const) : ([kv.slice(0, i), kv.slice(i + 1)] as const);
    });
  const set = new Map<string, string>(pairs);
  const apply = (k: string, v: string | undefined) => {
    if (v === undefined) return;
    const clean = utmValue(v);
    if (clean) set.set(k, clean);
    else set.delete(k);
  };
  apply("plan", p.plan);
  apply("utm_source", p.source);
  apply("utm_campaign", p.campaign);
  const q = [...set.entries()].map(([k, v]) => (v ? `${k}=${v}` : k)).join("&");
  return `${base}${q ? `?${q}` : ""}${hash}`;
}
