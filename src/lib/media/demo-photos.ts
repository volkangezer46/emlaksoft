/**
 * !!! GEÇİCİ TASLAK (STUB) — demo-sistem dalı derlensin diye. !!!
 *
 * Gerçek manifest paralel `demo-foto` dalında `node scripts/media/build-demo-photos.mjs` ile OTOMATİK üretilir ve birleşmede
 * BU DOSYANIN TAMAMINI değiştirir. Tipler ve yardımcılar o betiğin şablonundan BİREBİR alındı; yalnız listeler boştur
 * (örnek veri tohumu fotoğrafsız da çalışır). Tek tüketici: `src/lib/sample-data/demo-photo-pick.ts`.
 */

export type DemoPhotoKind =
  | "exterior"
  | "living"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "balcony"
  | "view"
  | "pool"
  | "garden"
  | "office"
  | "shop"
  | "land"
  | "building";

export type DemoPropertyType = "daire" | "rezidans" | "villa" | "mustakil" | "yali" | "yazlik" | "ofis" | "dukkan" | "arsa";

export type DemoPhotoFormat = "avif" | "webp";

export type DemoPhotoMeta = {
  id: string;
  kind: DemoPhotoKind;
  /** Ait olduğu ilan seti (DEMO_PHOTO_SETS[].id). */
  set: string;
  /** Setin kapak fotoğrafı mı (her setin ilk karesi). */
  cover: boolean;
  /** Türkçe alternatif metin. */
  alt: string;
  /** CSS object-position — kırpmada korunacak odak. */
  focal: string;
  /** Baskın renk (yükleme zemini). */
  color: string;
  /** En büyük varyantın boyutu (en-boy oranı için). */
  width: number;
  height: number;
  hash: string;
  /** AVIF genişlikleri. */
  widths: readonly number[];
  /** WebP (yedek) genişlikleri — 1600 üretilmez. */
  webpWidths: readonly number[];
  /** ~24 px bulanık önizleme (data URL; CSP img-src data: izinli). */
  lqip: string;
  credit: { provider: "Unsplash"; photographer: string; profileUrl: string; pageUrl: string; license: "Unsplash License"; licenseUrl: string };
};

export type DemoPhotoSetMeta = {
  id: string;
  /** Türkçe ilan başlığı önerisi. */
  title: string;
  propertyType: DemoPropertyType;
  listingType: "satilik" | "kiralik";
  /** Oda sayısı ("3+1"); arsa/ofis/dükkan için null olabilir. */
  rooms: string | null;
  /** Önerilen brüt m² (arsa için arazi m²). */
  areaM2: number;
  city: string;
  district: string;
  /** Tam TL. period "toplam" = satış fiyatı, "aylik" = aylık kira. */
  priceBand: { min: number; max: number; currency: "TRY"; period: "toplam" | "aylik" };
  coverId: string;
  photoIds: readonly string[];
};

export const DEMO_PHOTOS: readonly DemoPhotoMeta[] = [];

export const DEMO_PHOTO_SETS: readonly DemoPhotoSetMeta[] = [];

export type DemoPhotoId = string;
export type DemoPhotoSetId = string;

const BY_ID = new Map<string, DemoPhotoMeta>(DEMO_PHOTOS.map((p) => [p.id, p]));

export function demoPhoto(id: string): DemoPhotoMeta {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Bilinmeyen demo fotoğrafı: ${id}`);
  return p;
}

/** Biçimde var olan genişlikler (küçükten büyüğe). */
export function demoPhotoWidths(p: DemoPhotoMeta, fmt: DemoPhotoFormat): readonly number[] {
  return fmt === "avif" ? p.widths : p.webpWidths;
}

/** İstenen genişliğe en yakın (≤, yoksa en küçük) varyantın adresi. Örn. demoPhotoUrl(p, 960, "webp"). */
export function demoPhotoUrl(p: DemoPhotoMeta, width: number, fmt: DemoPhotoFormat): string {
  const ws = demoPhotoWidths(p, fmt);
  const w = [...ws].reverse().find((x) => x <= width) ?? ws[0];
  return `/img/demo/${p.id}-${p.hash}-${w}.${fmt}`;
}

export function demoPhotoSrcSet(p: DemoPhotoMeta, fmt: DemoPhotoFormat, maxWidth = Infinity): string {
  const ws = demoPhotoWidths(p, fmt).filter((w, i) => w <= maxWidth || i === 0);
  return ws.map((w) => `${demoPhotoUrl(p, w, fmt)} ${w}w`).join(", ");
}

export type DemoPhotoSet = { meta: DemoPhotoSetMeta; cover: DemoPhotoMeta; photos: DemoPhotoMeta[] };

/** Tüm ilan setleri: meta + sıralı fotoğraflar (photos[0] === cover). */
export function demoPhotoSets(): DemoPhotoSet[] {
  return DEMO_PHOTO_SETS.map((meta) => {
    const photos = meta.photoIds.map((id) => demoPhoto(id));
    return { meta, cover: demoPhoto(meta.coverId), photos };
  });
}

export function demoPhotosBySet(setId: string): DemoPhotoMeta[] {
  return DEMO_PHOTOS.filter((p) => p.set === setId);
}
