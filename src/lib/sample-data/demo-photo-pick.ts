import { demoPhotoSets, demoPhotoUrl, demoPhotoWidths, type DemoPhotoKind, type DemoPhotoMeta, type DemoPhotoSet, type DemoPropertyType } from "@/lib/media/demo-photos";

/**
 * Demo fotoğraf kütüphanesi → örnek portföy görseli eşleştirmesi (SAF). Kütüphanenin TEK tüketicisi budur: manifest alan
 * adları değişirse yalnız bu dosya uyarlanır.
 *
 * Saklama: `property_media` satırı `storage_path = NULL` + `external_url = /img/demo/...` (statik, immutable dosya) taşır.
 * Depo nesnesi YOKTUR: silme tetikleyicisi (storage_object_lifecycle) yolu boş satırda depo silmesi kuyruğa yazmaz, yani
 * "Gerçek kullanıma geç" statik dosyalara asla dokunmaz. Medya uçları (`/api/property-media/[id]`, `/thumb`, `/download`)
 * bu satırı `demoStaticTarget` ile tanır ve statik dosyaya yönlendirir; liste kartı, detay kapağı, vitrin, portal önizleme
 * ve Pano TV aynı uçları kullandığı için ayrı bir dal gerekmez.
 */

export const DEMO_STATIC_PREFIX = "/img/demo/";
/** Kayıtta saklanan biçim: WebP (her tarayıcı; en büyük türev 960). Küçük resimler manifestten daha dar türeve iner. */
export const DEMO_STORED_FORMAT = "webp" as const;

const SAFE_RE = /^\/img\/demo\/[a-z0-9][a-z0-9_\-/]*\.(?:webp|avif|jpe?g)$/;

/** Yalnız kütüphane yolu kabul edilir (dış adres, `..`, sorgu dizesi YOK): açık yönlendirme/SSRF kapısı kapalı. */
export function isDemoStaticPhotoUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && SAFE_RE.test(url) && !url.includes("..") && !url.includes("//", 1);
}

/** Medya satırı statik demo fotoğrafı mı? (depo yolu boş + güvenli statik adres) */
export function demoStaticTarget(media: { storage_path?: string | null; external_url?: string | null } | null | undefined): string | null {
  if (!media || media.storage_path) return null;
  return isDemoStaticPhotoUrl(media.external_url) ? media.external_url : null;
}

/** İstenen genişliğe en yakın türevin adresi (manifest kuralı: ≤ hedef, yoksa en küçük); fotoğraf manifestte yoksa saklanan adres. */
export function demoVariantUrl(storedUrl: string, targetWidth: number): string {
  for (const set of safeSets()) {
    for (const p of set.photos) {
      const own = (["webp", "avif"] as const).some((fmt) => demoPhotoWidths(p, fmt).some((w) => demoPhotoUrl(p, w, fmt) === storedUrl));
      if (own) return demoPhotoUrl(p, targetWidth, DEMO_STORED_FORMAT);
    }
  }
  return storedUrl;
}

function safeSets(): readonly DemoPhotoSet[] {
  try {
    const sets = demoPhotoSets();
    return Array.isArray(sets) ? sets.filter((s) => s && Array.isArray(s.photos) && s.photos.length > 0) : [];
  } catch {
    return [];
  }
}

/** Fotoğraf türü → oda etiketi (property_media.room_tag sabit listesi). */
const ROOM_TAG: Partial<Record<DemoPhotoKind, string>> = {
  exterior: "cephe",
  living: "salon",
  kitchen: "mutfak",
  bedroom: "yatak_odasi",
  bathroom: "banyo",
  balcony: "balkon",
  view: "manzara",
  pool: "havuz",
  garden: "bahce",
  building: "cephe",
};

/** Kütüphane mülk türü → properties.property_type sözlüğü. */
const LIBRARY_TYPE: Record<DemoPropertyType, string> = {
  daire: "Daire",
  rezidans: "Rezidans",
  villa: "Villa",
  mustakil: "Müstakil ev",
  yali: "Villa",
  yazlik: "Müstakil ev",
  ofis: "Ofis",
  dukkan: "Dükkan",
  arsa: "Arsa",
};

const TYPE_GROUP: Record<string, string> = {
  Daire: "konut",
  Rezidans: "konut",
  "Müstakil ev": "mustakil",
  Villa: "villa",
  Dükkan: "ticari",
  Ofis: "ofis",
  Arsa: "arsa",
};
const group = (t: string | null | undefined) => TYPE_GROUP[String(t ?? "")] ?? "konut";

export type DemoMediaRow = {
  external_url: string;
  file_name: string;
  file_type: string;
  kind: "image";
  is_cover: boolean;
  sort_order: number;
  width: number;
  height: number;
  caption: string;
  room_tag: string | null;
};

function score(set: DemoPhotoSet, p: { type: string; tx?: string; rooms: string | null; district: string }): number {
  const type = LIBRARY_TYPE[set.meta.propertyType] ?? "Daire";
  let s = 0;
  if (type === p.type) s += 6;
  else if (group(type) === group(p.type)) s += 4;
  else return -1;
  if (p.tx && (set.meta.listingType === "kiralik") === (p.tx === "Kiralık")) s += 2;
  if (p.rooms && set.meta.rooms === p.rooms) s += 2;
  if (set.meta.district === p.district) s += 1;
  return s;
}

/**
 * Portföylere set atar: her portföy en uygun (tür > oda > ilçe) ve mümkünse henüz kullanılmamış seti alır. Uygun set
 * yoksa (ör. kütüphane boş) portföy fotoğrafsız kalır. Sıra: dış cephe kapak olur, ardından setteki sıra.
 */
export function assignDemoPhotos<T extends { code: string; type: string; tx?: string; rooms: string | null; districtName: string }>(
  properties: readonly T[],
): Map<string, DemoMediaRow[]> {
  const sets = safeSets();
  const used = new Map<string, number>();
  const out = new Map<string, DemoMediaRow[]>();
  for (const p of properties) {
    let best: DemoPhotoSet | null = null;
    let bestScore = -1;
    for (const set of sets) {
      const s = score(set, { type: p.type, tx: p.tx, rooms: p.rooms, district: p.districtName });
      if (s < 0) continue;
      const adjusted = s * 10 - (used.get(set.meta.id) ?? 0) * 25;
      if (best == null || adjusted > bestScore) {
        best = set;
        bestScore = adjusted;
      }
    }
    if (!best) continue;
    used.set(best.meta.id, (used.get(best.meta.id) ?? 0) + 1);
    out.set(p.code, mediaRowsFor(best.photos));
  }
  return out;
}

export function mediaRowsFor(photos: readonly DemoPhotoMeta[]): DemoMediaRow[] {
  // Kapak (manifestte `cover`, yoksa dış cephe) önce; en çok 8 kare.
  const rank = (p: DemoPhotoMeta) => (p.cover ? 2 : p.kind === "exterior" ? 1 : 0);
  const ordered = [...photos].sort((a, b) => rank(b) - rank(a)).slice(0, 8);
  return ordered.map((p, i) => {
    const widths = [...demoPhotoWidths(p, DEMO_STORED_FORMAT)].sort((a, b) => a - b);
    const w = widths.at(-1) ?? p.width;
    return {
      external_url: demoPhotoUrl(p, w, DEMO_STORED_FORMAT),
      file_name: `ornek-${p.id}.webp`.slice(0, 160),
      file_type: "image/webp",
      kind: "image" as const,
      is_cover: i === 0,
      sort_order: i,
      width: w,
      height: Math.max(1, Math.round((p.height / Math.max(1, p.width)) * w)),
      caption: p.alt.slice(0, 80),
      room_tag: ROOM_TAG[p.kind] ?? null,
    };
  });
}

/** Tek setin satırları (örnek ofis tohumu: ilan zaten setten kurulduğu için eşleştirme gerekmez). Set yoksa boş. */
export function mediaRowsForSet(setId: string): DemoMediaRow[] {
  const set = safeSets().find((x) => x.meta.id === setId);
  return set ? mediaRowsFor(set.photos) : [];
}
