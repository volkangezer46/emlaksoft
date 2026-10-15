/**
 * Portföy medyası oda etiketi + açıklama + kat planı — SAF yardımcılar (istemci ve sunucu ortak).
 *
 * Kalıcı alanlar `property_media.room_tag` ve `property_media.caption` (migration 20261019030000). Kat planı ayrı bir
 * medya TÜRÜ değil, `room_tag = 'kat_plani'` etiketli ilan görselidir: böylece public servis uçları, portal aktarımı ve
 * KVKK belge kuralı (`isPublicListingImage`, `kind = 'image'`) hiç değişmeden kat planını da kapsar; yüzeyler (vitrin,
 * paylaşım, sunum, broşür, medya yöneticisi) kat planlarını ayrı sekme/bölümde gösterir ve kapak seçmez.
 *
 * Etiket listesi SQL CHECK'i (`property_media_room_tag_check`) ile BİREBİR aynıdır; sözleşme testi
 * (`room-tags.test.ts`) migration metnini okuyup karşılaştırır.
 */

export const ROOM_TAGS = [
  "salon",
  "oturma_odasi",
  "mutfak",
  "yatak_odasi",
  "cocuk_odasi",
  "calisma_odasi",
  "banyo",
  "wc",
  "antre",
  "koridor",
  "balkon",
  "teras",
  "bahce",
  "cephe",
  "manzara",
  "havuz",
  "otopark",
  "ortak_alan",
  "kat_plani",
] as const;

export type RoomTag = (typeof ROOM_TAGS)[number];

export const FLOOR_PLAN_TAG = "kat_plani" satisfies RoomTag;

export const ROOM_TAG_LABEL: Record<RoomTag, string> = {
  salon: "Salon",
  oturma_odasi: "Oturma odası",
  mutfak: "Mutfak",
  yatak_odasi: "Yatak odası",
  cocuk_odasi: "Çocuk odası",
  calisma_odasi: "Çalışma odası",
  banyo: "Banyo",
  wc: "WC",
  antre: "Antre",
  koridor: "Koridor",
  balkon: "Balkon",
  teras: "Teras",
  bahce: "Bahçe",
  cephe: "Dış cephe",
  manzara: "Manzara",
  havuz: "Havuz",
  otopark: "Otopark",
  ortak_alan: "Ortak alan",
  kat_plani: "Kat planı",
};

/** Açıklama üst sınırı (SQL CHECK ile aynı). */
export const CAPTION_MAX = 80;

export function isRoomTag(value: unknown): value is RoomTag {
  return typeof value === "string" && (ROOM_TAGS as readonly string[]).includes(value);
}

/** Girdi → geçerli etiket ya da null (boş / bilinmeyen değer etiketi kaldırır). */
export function normalizeRoomTag(value: unknown): RoomTag | null {
  const v = typeof value === "string" ? value.trim() : "";
  return isRoomTag(v) ? v : null;
}

/** Açıklamayı tek satıra indirger, kontrol karakterlerini atar ve 80 karakterde keser. Boş → null. */
export function normalizeCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return Array.from(clean).slice(0, CAPTION_MAX).join("").trim() || null;
}

export function isFloorPlan(m: { room_tag?: string | null }): boolean {
  return m.room_tag === FLOOR_PLAN_TAG;
}

/** Galeri satırlarını fotoğraf ve kat planı olarak ikiye ayırır (sıra korunur). */
export function splitFloorPlans<T extends { room_tag?: string | null }>(rows: readonly T[]): { photos: T[]; floorPlans: T[] } {
  const photos: T[] = [];
  const floorPlans: T[] = [];
  for (const r of rows) (isFloorPlan(r) ? floorPlans : photos).push(r);
  return { photos, floorPlans };
}

/**
 * Görselin alt metni: açıklama > oda etiketi > yedek. `title` (ilan başlığı) verilirse etiketle birleştirilir
 * ("Salon · Kadıköy 3+1"). Sabit "Portföy görseli" yerine erişilebilir ve aranabilir metin.
 */
export function mediaAltText(
  m: { room_tag?: string | null; caption?: string | null },
  fallback: string,
  title?: string | null,
): string {
  const caption = normalizeCaption(m.caption);
  const tag = normalizeRoomTag(m.room_tag);
  const head = caption ?? (tag ? ROOM_TAG_LABEL[tag] : null);
  if (!head) return fallback;
  const t = (title ?? "").trim();
  return t ? `${head} · ${t}` : head;
}

/** Kısa görünür etiket (kart rozeti / küçük resim altı): açıklama varsa o, yoksa oda etiketi. */
export function mediaShortLabel(m: { room_tag?: string | null; caption?: string | null }): string | null {
  const caption = normalizeCaption(m.caption);
  if (caption) return caption;
  const tag = normalizeRoomTag(m.room_tag);
  return tag ? ROOM_TAG_LABEL[tag] : null;
}
