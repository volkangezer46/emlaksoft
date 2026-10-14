import { heroBudget } from "@/lib/site-media/quota";
import { mediaUrl, type SiteMediaRow } from "@/lib/site-media/types";

/** Görsel seçicide gösterilen medya özeti (saf; sunucu sayfası ve istemci seçici ortak). */
export type PickerMedia = { id: string; alt: string; w: number; h: number; thumb: string | null; heroBytes: number; heroOver: boolean };
export type MediaLibraryState = { status: "ok" | "missing" | "error"; items: PickerMedia[] };

export function toPickerMedia(m: Pick<SiteMediaRow, "id" | "alt" | "w" | "h" | "variants">): PickerMedia {
  const small = [...m.variants].filter((v) => v.format === "webp").sort((a, b) => a.w - b.w)[0] ?? m.variants[0];
  const hb = heroBudget(m.variants);
  return { id: m.id, alt: m.alt, w: m.w, h: m.h, thumb: small ? mediaUrl(m.id, small.file) : null, heroBytes: hb.bytes, heroOver: hb.over };
}
