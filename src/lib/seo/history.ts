import { getPlatformSetting } from "@/lib/platform-settings";
import { SEO_KEYS } from "./schema";

/**
 * SEO ayar geçmişi (`seo.history` halkası). Yazma `writeSeoSetting` içinde (store.ts) yapılır: her kayıttan ÖNCE
 * mevcut değer halkaya eklenir. Halka en yeni başta, en çok 30 kayıt ve 300 KB'tır; robot denetimi (seo.audit.*)
 * ve IndexNow anahtarları halkaya GİRMEZ (makine durumu, geri dönülecek ayar değil).
 */

export type SeoHistoryKey = keyof typeof SEO_KEYS;

export type SeoHistoryEntry = {
  id: string;
  /** SEO_KEYS anahtar adı (global, pages, sitemap, robots, redirects, patterns). */
  key: SeoHistoryKey;
  /** Değişikliğin zamanı (ISO). */
  at: string;
  /** Değiştiren personel kimliği (yoksa sistem). */
  by: string | null;
  byName?: string | null;
  /** Değişiklikten ÖNCEKİ ham JSON değeri; null = ayar hiç yoktu (varsayılan). */
  prev: string | null;
};

export const SEO_HISTORY_MAX_ENTRIES = 30;
export const SEO_HISTORY_MAX_BYTES = 300 * 1024;

/** Geçmişe giren anahtarlar (yönetici ayarları). Denetim ve IndexNow durumları hariç. */
export const SEO_HISTORY_KEYS: readonly SeoHistoryKey[] = ["global", "pages", "sitemap", "robots", "redirects", "patterns"];

export function isHistoryTracked(key: SeoHistoryKey): boolean {
  return SEO_HISTORY_KEYS.includes(key);
}

export const SEO_HISTORY_LABELS: Partial<Record<SeoHistoryKey, string>> = {
  global: "Genel",
  pages: "Sayfalar",
  sitemap: "Sitemap",
  robots: "robots.txt",
  redirects: "Yönlendirmeler",
  patterns: "Dinamik kalıplar",
};

export function parseSeoHistory(raw: string | null): SeoHistoryEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is SeoHistoryEntry =>
        Boolean(e) &&
        typeof (e as SeoHistoryEntry).id === "string" &&
        typeof (e as SeoHistoryEntry).at === "string" &&
        isHistoryTracked((e as SeoHistoryEntry).key) &&
        ((e as SeoHistoryEntry).prev === null || typeof (e as SeoHistoryEntry).prev === "string"),
    );
  } catch {
    return [];
  }
}

/** Yeni kaydı başa ekler; sayı ve bayt sınırına göre en eskiler düşer (en yeni kayıt her zaman kalır). */
export function pushSeoHistory(list: SeoHistoryEntry[], entry: SeoHistoryEntry): SeoHistoryEntry[] {
  let out = [entry, ...list].slice(0, SEO_HISTORY_MAX_ENTRIES);
  while (out.length > 1 && new TextEncoder().encode(JSON.stringify(out)).length > SEO_HISTORY_MAX_BYTES) out = out.slice(0, -1);
  return out;
}

/** Yönetim ekranı: geçmiş listesi (en yeni başta). */
export async function listSeoHistory(): Promise<SeoHistoryEntry[]> {
  return parseSeoHistory(await getPlatformSetting(SEO_KEYS.history));
}

/* ---------- Alan farkı ---------- */

export type SeoFieldDiff = { path: string; before: string | null; after: string | null };

function flatten(value: unknown, prefix: string, out: Map<string, string>) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    // Kimlikli diziler (yönlendirmeler) kimlikle eşleşir; diğerleri sıra ile.
    value.forEach((v, i) => {
      const id = v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : String(i);
      flatten(v, prefix ? `${prefix}[${id}]` : `[${id}]`, out);
    });
    if (value.length === 0 && prefix) out.set(prefix, "[]");
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix || "(değer)", String(value));
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * İki ham JSON değer arasındaki alan farkları (düz yol: `pages./fiyatlar.title`). `before` = geçmişteki değer,
 * `after` = şimdiki değer. Sınır: ilk `limit` fark (ekran için).
 */
export function diffSeoValues(beforeRaw: string | null, afterRaw: string | null, limit = 50): { diffs: SeoFieldDiff[]; total: number } {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(parseJson(beforeRaw), "", a);
  flatten(parseJson(afterRaw), "", b);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const diffs: SeoFieldDiff[] = [];
  for (const k of keys) {
    const x = a.get(k) ?? null;
    const y = b.get(k) ?? null;
    if (x !== y) diffs.push({ path: k, before: x, after: y });
  }
  return { diffs: diffs.slice(0, limit), total: diffs.length };
}
