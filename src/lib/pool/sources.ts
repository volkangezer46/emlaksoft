/**
 * Havuz kaynak etiketleri (SAF). `listing_pool_entries.source` CHECK'iyle birebir (20261010000800 'extension' ekler).
 * "Gelen ilan" kaynakları (portal/form, ağ, API, eklenti) danışmansız açılıp havuza düşer; "manual" yalnız danışman istediğinde.
 */
export const POOL_SOURCES = ["manual", "import", "portal_form", "network", "api", "transfer", "extension"] as const;
export type PoolSourceKey = (typeof POOL_SOURCES)[number];

export const POOL_SOURCE_LABELS: Record<PoolSourceKey, string> = {
  manual: "Elle ekleme",
  import: "İçe aktarma",
  portal_form: "Portal / form",
  network: "Ağ / MLS",
  api: "API",
  transfer: "Devir",
  extension: "Eklenti",
};

/** Formdan gelebilen DIŞ kaynaklar (içe aktarma ve devir kendi akışından yazılır). */
const INCOMING: readonly PoolSourceKey[] = ["portal_form", "network", "api", "extension"];

/** Form alanı `pool_source` -> kaynak. Bilinmeyen/boş değer "manual" olur (istemci rastgele kaynak yazamaz). */
export function parseIncomingPoolSource(v: unknown): PoolSourceKey {
  return typeof v === "string" && (INCOMING as readonly string[]).includes(v) ? (v as PoolSourceKey) : "manual";
}

/** Gelen (dış kaynaklı) ilan mı: danışmanı atanmadıkça havuza düşer. */
export function isIncomingPoolSource(s: PoolSourceKey): boolean {
  return INCOMING.includes(s);
}

export function poolSourceLabel(s: string): string {
  return (POOL_SOURCE_LABELS as Record<string, string>)[s] ?? s;
}
