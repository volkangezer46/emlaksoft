/**
 * "Çevrede neler var" (PUB-8) — SAF, testli; istemciden de içe aktarılır (sunucu modülü yok).
 *
 * Neden danışman girdisi: dış harita anahtarı yok ve kamu Overpass sunucusu oran sınırlı/güvenilmez; SSRF korumalı
 * ortak dış istek yardımcısı da yok. Danışman portföy sayfasında yakın noktaları (kategori, ad, mesafe) girer; değer
 * `properties.nearby_places` jsonb dizisinde durur (migration 20261019010001). Vitrin ilan detayı bunu kategori sırasıyla,
 * kuş uçuşu metre + yürüme süresiyle gösterir. Konum gizliliği: tam adres/koordinat kullanılmaz, yalnız ad + mesafe.
 */

export const NEARBY_CATEGORIES = [
  { key: "okul", label: "Okul" },
  { key: "universite", label: "Üniversite" },
  { key: "metro", label: "Metro / raylı sistem" },
  { key: "otobus", label: "Otobüs / minibüs durağı" },
  { key: "hastane", label: "Hastane / sağlık" },
  { key: "market", label: "Market" },
  { key: "avm", label: "AVM / çarşı" },
  { key: "park", label: "Park / yeşil alan" },
  { key: "cami", label: "Cami / ibadethane" },
  { key: "sahil", label: "Sahil" },
  { key: "diger", label: "Diğer" },
] as const;

export type NearbyCategory = (typeof NEARBY_CATEGORIES)[number]["key"];
export type NearbyPlace = { c: NearbyCategory; n: string; m: number };

export const NEARBY_MAX_ITEMS = 24;
export const NEARBY_NAME_MAX = 60;
/** Mesafe üst sınırı (m): 50 km — "havalimanı 35 km" gibi girişler de geçerli. */
export const NEARBY_MAX_METERS = 50_000;

const CATEGORY_KEYS = new Set<string>(NEARBY_CATEGORIES.map((c) => c.key));

export function nearbyCategoryLabel(c: string): string {
  return NEARBY_CATEGORIES.find((x) => x.key === c)?.label ?? "Diğer";
}

function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NEARBY_NAME_MAX) : "";
}

/** Sayı ya da "850", "850 m", "1,2 km", "1.5km" → metre (10 m'ye yuvarlı); geçersiz → null. */
function cleanMeters(v: unknown): number | null {
  let n = NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^([0-9]+(?:[.,][0-9]+)?)\s*(km|m|mt|metre)?$/i.exec(v.trim());
    if (m) n = Number(m[1].replace(",", ".")) * (m[2]?.toLowerCase() === "km" ? 1000 : 1);
  }
  if (!Number.isFinite(n) || n <= 0 || n > NEARBY_MAX_METERS) return null;
  return Math.max(10, Math.round(n / 10) * 10);
}

/** Kayıtlı değeri güvenle okur: bozuk öğe atılır, en çok 24, kategori sırası + mesafe sırası. */
export function parseNearbyPlaces(raw: unknown): NearbyPlace[] {
  if (!Array.isArray(raw)) return [];
  const out: NearbyPlace[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const c = typeof o.c === "string" && CATEGORY_KEYS.has(o.c) ? (o.c as NearbyCategory) : null;
    const n = cleanName(o.n);
    const m = cleanMeters(o.m);
    if (!c || !n || m == null) continue;
    out.push({ c, n, m });
    if (out.length >= NEARBY_MAX_ITEMS) break;
  }
  return sortNearby(out);
}

const ORDER = new Map<string, number>(NEARBY_CATEGORIES.map((c, i) => [c.key, i]));

export function sortNearby(list: readonly NearbyPlace[]): NearbyPlace[] {
  return [...list].sort((a, b) => (ORDER.get(a.c) ?? 99) - (ORDER.get(b.c) ?? 99) || a.m - b.m);
}

export type NearbyValidation = { ok: true; places: NearbyPlace[] } | { ok: false; error: string };

/**
 * Form girdisini doğrular (sunucu eylemi). Boş satır (ad ve mesafe boş) atlanır; yarım satır açık hatayla reddedilir,
 * sessiz yok sayılmaz. Mesafe metre; "1,2 km" gibi girişler istemcide metreye çevrilir.
 */
export function validateNearbyInput(rows: readonly { c?: unknown; n?: unknown; m?: unknown }[]): NearbyValidation {
  const places: NearbyPlace[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = cleanName(r.n);
    const rawM = r.m == null ? "" : String(r.m).trim();
    if (!name && !rawM) continue;
    const row = i + 1;
    if (typeof r.c !== "string" || !CATEGORY_KEYS.has(r.c)) return { ok: false, error: `${row}. satır: tür seçin.` };
    if (!name) return { ok: false, error: `${row}. satır: yerin adını yazın.` };
    const m = cleanMeters(rawM);
    if (m == null) return { ok: false, error: `${row}. satır: mesafeyi metre olarak girin (en çok 50.000).` };
    places.push({ c: r.c as NearbyCategory, n: name, m });
  }
  if (places.length > NEARBY_MAX_ITEMS) return { ok: false, error: `En çok ${NEARBY_MAX_ITEMS} yer eklenebilir.` };
  return { ok: true, places: sortNearby(places) };
}

/** Kuş uçuşu mesafe metni: 850 m · 1,2 km. */
export function formatDistance(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${km.toLocaleString("tr-TR", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/**
 * Yürüme süresi (dk) — kuş uçuşu mesafe × 1,25 (sokak dolambacı) / 80 m/dk. 2,5 km üstünde yürüme önerilmez (null).
 */
export function walkingMinutes(m: number): number | null {
  if (m > 2500) return null;
  return Math.max(1, Math.round((m * 1.25) / 80));
}

/** Kategoriye göre gruplar (görünüm sırası korunur). */
export function groupNearby(list: readonly NearbyPlace[]): { category: NearbyCategory; label: string; items: NearbyPlace[] }[] {
  const groups = new Map<NearbyCategory, NearbyPlace[]>();
  for (const p of sortNearby(list)) {
    const g = groups.get(p.c);
    if (g) g.push(p);
    else groups.set(p.c, [p]);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, label: nearbyCategoryLabel(category), items }));
}
