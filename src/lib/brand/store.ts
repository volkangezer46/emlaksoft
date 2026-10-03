import { unstable_cache } from "next/cache";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import {
  BRAND_SLOTS,
  EMPTY_BRAND_META,
  isBrandSlot,
  type BrandAssetType,
  type BrandMeta,
  type BrandSlot,
  type BrandSlotInfo,
} from "./slots";

/**
 * Platform markası depolama: mevcut `platform_settings` anahtar-değer tablosu (yeni migration gerekmez).
 *   brand.meta           -> {"slots":{"logo-light":{"type":"svg","v":170...,"bytes":1234}}}
 *   brand.asset.<slot>   -> {"type":"svg","data":"<svg…>"}  |  {"type":"png","data":"<base64>"}
 * Okuma/yazma yalnız src/lib/platform-settings.ts (kabul listesinde) üzerinden yapılır.
 * Tablo yoksa/okunamazsa her şey varsayılan markaya düşer; yazma açık hata döner.
 */

export const BRAND_CACHE_TAG = "platform-brand";
const META_KEY = "brand.meta";
const assetKey = (slot: BrandSlot) => `brand.asset.${slot}`;

export type StoredBrandAsset = { type: BrandAssetType; data: string };

export function parseBrandMeta(raw: string | null): BrandMeta {
  if (!raw) return EMPTY_BRAND_META;
  try {
    const parsed = JSON.parse(raw) as { slots?: Record<string, Partial<BrandSlotInfo>> };
    const slots: BrandMeta["slots"] = {};
    for (const [key, info] of Object.entries(parsed.slots ?? {})) {
      if (!isBrandSlot(key) || !info) continue;
      if ((info.type !== "svg" && info.type !== "png") || typeof info.v !== "number") continue;
      slots[key] = { type: info.type, v: info.v, bytes: typeof info.bytes === "number" ? info.bytes : 0 };
    }
    return { slots };
  } catch {
    return EMPTY_BRAND_META;
  }
}

function parseAsset(raw: string | null): StoredBrandAsset | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<StoredBrandAsset>;
    if ((p.type !== "svg" && p.type !== "png") || typeof p.data !== "string") return null;
    return { type: p.type, data: p.data };
  } catch {
    return null;
  }
}

/** Kısa süreli önbellekli meta (tenant bağımsız). Hata/yok -> varsayılan marka. */
export const getBrandMeta = unstable_cache(
  async (): Promise<BrandMeta> => parseBrandMeta(await getPlatformSetting(META_KEY)),
  ["platform-brand-meta-v1"],
  { tags: [BRAND_CACHE_TAG], revalidate: 60 },
);

export const getBrandAsset = unstable_cache(
  async (slot: BrandSlot): Promise<StoredBrandAsset | null> => parseAsset(await getPlatformSetting(assetKey(slot))),
  ["platform-brand-asset-v1"],
  { tags: [BRAND_CACHE_TAG], revalidate: 300 },
);

/** Önbelleksiz güncel meta (yönetim sayfası ve yazma yolu). */
export async function readBrandMetaFresh(): Promise<BrandMeta> {
  return parseBrandMeta(await getPlatformSetting(META_KEY));
}

export const BRAND_STORAGE_UNAVAILABLE =
  "Marka ayarı henüz etkin değil: platform ayarları tablosuna yazılamadı. Veritabanı bağlantısını ve platform_settings tablosunu (migration 20260722000025) kontrol edin.";

async function writeMeta(meta: BrandMeta, staffId: string): Promise<boolean> {
  const ok = await setPlatformSetting(META_KEY, JSON.stringify(meta), staffId);
  if (!ok) return false;
  return (await getPlatformSetting(META_KEY)) === JSON.stringify(meta);
}

export async function saveBrandAsset(
  slot: BrandSlot,
  asset: StoredBrandAsset,
  bytes: number,
  staffId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = JSON.stringify(asset);
  if (!(await setPlatformSetting(assetKey(slot), payload, staffId))) {
    return { ok: false, error: BRAND_STORAGE_UNAVAILABLE };
  }
  if ((await getPlatformSetting(assetKey(slot))) !== payload) {
    return { ok: false, error: BRAND_STORAGE_UNAVAILABLE };
  }
  const meta = await readBrandMetaFresh();
  const next: BrandMeta = { slots: { ...meta.slots, [slot]: { type: asset.type, v: Date.now(), bytes } } };
  if (!(await writeMeta(next, staffId))) return { ok: false, error: BRAND_STORAGE_UNAVAILABLE };
  return { ok: true };
}

export async function resetBrandSlots(
  slots: readonly BrandSlot[],
  staffId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const meta = await readBrandMetaFresh();
  const next: BrandMeta = { slots: { ...meta.slots } };
  for (const s of slots) delete next.slots[s];
  if (!(await writeMeta(next, staffId))) return { ok: false, error: BRAND_STORAGE_UNAVAILABLE };
  // Varlık satırlarını da boşalt (meta zaten yayını belirler; boşaltma yalnız depo temizliği).
  for (const s of slots) await setPlatformSetting(assetKey(s), null, staffId);
  return { ok: true };
}

export const ALL_BRAND_SLOTS = BRAND_SLOTS;
