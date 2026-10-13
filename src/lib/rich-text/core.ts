import type { ToolSlug } from "@/lib/tools/registry";
import { plainInline } from "./parse-inline";

/**
 * Zengin metin blokları: zod'suz çekirdek (türler, sınırlar, etiketler, saf yardımcılar; istemci editörü içe aktarır).
 * Gövde bir BLOK DİZİSİDİR; ham HTML hiçbir alanda işlenmez. Satır içi biçim (**kalın**, *italik*, [metin](href))
 * yalnız paragraf, madde, alıntı, uyarı kutusu metni ve SSS cevabında ayrıştırılır; başlıklar, tablo hücreleri ve
 * SSS sorusu düz metindir. Şema/doğrulayıcı schema.ts'te, renderer render.tsx'te.
 */

export const RICH_LIMITS = {
  maxBlocks: 200,
  /** Her metin alanı üst sınırı (karakter). */
  text: 2000,
  maxListItems: 40,
  maxColumns: 8,
  maxRows: 60,
  maxFaq: 20,
  caption: 200,
} as const;

export const RICH_BLOCK_TYPES = ["p", "h2", "h3", "ul", "ol", "quote", "callout", "table", "faq", "toolEmbed"] as const;
export type RichBlockType = (typeof RICH_BLOCK_TYPES)[number];

export const RICH_BLOCK_LABEL: Record<RichBlockType, string> = {
  p: "Paragraf",
  h2: "Ara başlık (H2)",
  h3: "Alt başlık (H3)",
  ul: "Madde listesi",
  ol: "Numaralı liste",
  quote: "Alıntı",
  callout: "Bilgi kutusu",
  table: "Tablo",
  faq: "Sık sorulan sorular",
  toolEmbed: "Araç kartı",
};

export const CALLOUT_TONES = ["bilgi", "ipucu", "uyari"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
export const CALLOUT_TONE_LABEL: Record<CalloutTone, string> = { bilgi: "Bilgi", ipucu: "İpucu", uyari: "Dikkat" };

/** Gömülebilir araçlar: yalnız yayındaki 4 hesaplayıcı (tools/registry.ts; test kayıtla eşitliği doğrular). */
export const TOOL_EMBED_SLUGS = [
  "komisyon-hesaplama",
  "tapu-masrafi-hesaplama",
  "kira-getirisi-hesaplama",
  "konut-kredisi-taksit-hesaplama",
] as const satisfies readonly ToolSlug[];
export type ToolEmbedSlug = (typeof TOOL_EMBED_SLUGS)[number];

export type ParagraphBlock = { type: "p"; text: string };
export type HeadingBlock = { type: "h2" | "h3"; text: string };
export type ListBlock = { type: "ul" | "ol"; items: string[] };
export type QuoteBlock = { type: "quote"; text: string; cite?: string };
export type CalloutBlock = { type: "callout"; tone: CalloutTone; title?: string; text: string };
export type TableBlock = { type: "table"; caption?: string; head: string[]; rows: string[][] };
export type FaqBlock = { type: "faq"; items: Array<{ q: string; a: string }> };
export type ToolEmbedBlock = { type: "toolEmbed"; slug: ToolEmbedSlug };
export type RichBlock = ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | CalloutBlock | TableBlock | FaqBlock | ToolEmbedBlock;

/** Boş blok (editör "Blok ekle"). Saf. */
export function emptyRichBlock(type: RichBlockType): RichBlock {
  switch (type) {
    case "p":
      return { type, text: "" };
    case "h2":
    case "h3":
      return { type, text: "Başlık" };
    case "ul":
    case "ol":
      return { type, items: [""] };
    case "quote":
      return { type, text: "" };
    case "callout":
      return { type, tone: "bilgi", text: "" };
    case "table":
      return { type, head: ["Sütun 1", "Sütun 2"], rows: [["", ""]] };
    case "faq":
      return { type, items: [{ q: "Soru", a: "Cevap" }] };
    case "toolEmbed":
      return { type, slug: TOOL_EMBED_SLUGS[0] };
  }
}

/** Başlıktan sayfa içi kimlik (Türkçe harf sadeleşir). Çakışan kimliğe -2, -3 eklenir (`used` güncellenir). */
export function headingId(text: string, used: Set<string>): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  const base =
    String(text ?? "")
      .toLocaleLowerCase("tr")
      .replace(/[çğıİöşüâîû]/g, (c) => map[c] ?? c)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "bolum";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

export type TocEntry = { id: string; text: string };

/** H2 başlıklarından içindekiler; kimlikler renderer'la AYNI sırayla üretilir (headingIds). */
export function tocOf(blocks: readonly RichBlock[]): TocEntry[] {
  const ids = headingIds(blocks);
  const out: TocEntry[] = [];
  blocks.forEach((b, i) => {
    if (b.type === "h2" && b.text.trim()) out.push({ id: ids[i]!, text: b.text.trim() });
  });
  return out;
}

/** Blok sırasıyla başlık kimlikleri (başlık olmayan blokta undefined). */
export function headingIds(blocks: readonly RichBlock[]): Array<string | undefined> {
  const used = new Set<string>();
  return blocks.map((b) => (b.type === "h2" || b.type === "h3" ? headingId(b.text, used) : undefined));
}

/** Görünen düz metin (okuma süresi, ince içerik, RSS özeti). */
export function plainTextOf(blocks: readonly RichBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "p":
        parts.push(plainInline(b.text));
        break;
      case "h2":
      case "h3":
        parts.push(b.text);
        break;
      case "ul":
      case "ol":
        parts.push(...b.items.map(plainInline));
        break;
      case "quote":
        parts.push(plainInline(b.text), b.cite ?? "");
        break;
      case "callout":
        parts.push(b.title ?? "", plainInline(b.text));
        break;
      case "table":
        parts.push(b.caption ?? "", ...b.head, ...b.rows.flat());
        break;
      case "faq":
        for (const it of b.items) parts.push(it.q, plainInline(it.a));
        break;
      case "toolEmbed":
        break;
    }
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Okuma süresi (dakika, en az 1): dakikada ~200 kelime. */
export function readingMinutes(blocks: readonly RichBlock[]): number {
  return Math.max(1, Math.round(wordCount(plainTextOf(blocks)) / 200));
}

/** İlk paragraftan kelime ortasında kesmeyen özet. Saf. */
export function excerptOf(blocks: readonly RichBlock[], max = 200): string {
  const first = blocks.find((b): b is ParagraphBlock => b.type === "p" && b.text.trim().length > 0);
  const t = (first ? plainInline(first.text) : plainTextOf(blocks)).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const s = t.slice(0, max - 1);
  const sp = s.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? s.slice(0, sp) : s).replace(/[\s,;:.-]+$/, "")}…`;
}

/** Gövdedeki araç kartlarının araçları (ilgili araçlar listesi). */
export function embeddedTools(blocks: readonly RichBlock[]): ToolEmbedSlug[] {
  const out: ToolEmbedSlug[] = [];
  for (const b of blocks) if (b.type === "toolEmbed" && !out.includes(b.slug)) out.push(b.slug);
  return out;
}

export function moveBlock<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
