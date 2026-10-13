import { z } from "zod";
import { CALLOUT_TONES, RICH_LIMITS as L, TOOL_EMBED_SLUGS, type RichBlock } from "./core";
import { parseInline } from "./parse-inline";

export * from "./core";

/**
 * Zengin metin şeması (SAF; sunucu ve editörün tembel doğrulayıcısı ortak). Her blok `strictObject`: bilinmeyen tür ya da
 * fazladan alan (ör. `html`) reddedilir. Sınırlar: en çok 200 blok, her metin en çok 2.000 karakter, tablo en çok 8 sütun.
 * `validateRichBody` satır içi biçimi ayrıştırır: güvensiz bağlantı HATA, kırık iç bağlantı ve HTML etiketi UYARI.
 */

export type RichIssue = { level: "error" | "warn"; path: string; message: string };

const text = (label: string, max: number = L.text) => z.string().max(max, `${label} en fazla ${max} karakter olabilir.`);
const required = (label: string, max: number = L.text) => text(label, max).refine((v) => v.trim().length > 0, `${label} boş olamaz.`);

/** strictObject + Türkçe "tanınmayan alan" iletisi (ör. `html` alanı reddedilir). */
function strict<T extends z.core.$ZodLooseShape>(shape: T) {
  return z.strictObject(shape, { error: (iss) => (iss.code === "unrecognized_keys" ? `Tanınmayan alan: ${iss.keys.join(", ")}` : undefined) });
}

const paragraph = strict({ type: z.literal("p"), text: text("Paragraf") });
const h2 = strict({ type: z.literal("h2"), text: required("Başlık", 160) });
const h3 = strict({ type: z.literal("h3"), text: required("Başlık", 160) });
const items = z.array(text("Madde")).min(1, "Liste boş olamaz.").max(L.maxListItems, `En fazla ${L.maxListItems} madde olabilir.`);
const ul = strict({ type: z.literal("ul"), items });
const ol = strict({ type: z.literal("ol"), items });
const quote = strict({ type: z.literal("quote"), text: required("Alıntı"), cite: text("Kaynak", 160).optional() });
const callout = strict({
  type: z.literal("callout"),
  tone: z.enum(CALLOUT_TONES),
  title: text("Kutu başlığı", 160).optional(),
  text: required("Kutu metni"),
});
const cell = text("Hücre", 300);
const table = z
  .strictObject({
    type: z.literal("table"),
    caption: text("Tablo başlığı", L.caption).optional(),
    head: z.array(cell).min(1, "Tabloda en az 1 sütun olmalı.").max(L.maxColumns, `Tablo en fazla ${L.maxColumns} sütun olabilir.`),
    rows: z.array(z.array(cell).max(L.maxColumns, `Tablo en fazla ${L.maxColumns} sütun olabilir.`)).max(L.maxRows, `Tablo en fazla ${L.maxRows} satır olabilir.`),
  })
  .refine((t) => t.rows.every((r) => r.length === t.head.length), { message: "Her satırda başlıktaki kadar hücre olmalı.", path: ["rows"] });
const faq = strict({
  type: z.literal("faq"),
  items: z
    .array(strict({ q: required("Soru", 300), a: required("Cevap") }))
    .min(1, "En az bir soru olmalı.")
    .max(L.maxFaq, `En fazla ${L.maxFaq} soru olabilir.`),
});
const toolEmbed = strict({ type: z.literal("toolEmbed"), slug: z.enum(TOOL_EMBED_SLUGS) });

export const richBlockSchema = z.discriminatedUnion("type", [paragraph, h2, h3, ul, ol, quote, callout, table, faq, toolEmbed], {
  error: "Bilinmeyen blok türü.",
});

export const richBodySchema = z.array(richBlockSchema).max(L.maxBlocks, `En fazla ${L.maxBlocks} blok olabilir.`);

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const HTML_TAG_RE = /<\s*\/?\s*[a-z!]/i;

/** Blok başına (yol, değer, satır içi biçimli mi). */
function fieldsOf(b: RichBlock, base: string): Array<{ path: string; value: string; inline: boolean }> {
  switch (b.type) {
    case "p":
      return [{ path: `${base}.text`, value: b.text, inline: true }];
    case "h2":
    case "h3":
      return [{ path: `${base}.text`, value: b.text, inline: false }];
    case "ul":
    case "ol":
      return b.items.map((v, i) => ({ path: `${base}.items.${i}`, value: v, inline: true }));
    case "quote":
      return [
        { path: `${base}.text`, value: b.text, inline: true },
        ...(b.cite ? [{ path: `${base}.cite`, value: b.cite, inline: false }] : []),
      ];
    case "callout":
      return [
        ...(b.title ? [{ path: `${base}.title`, value: b.title, inline: false }] : []),
        { path: `${base}.text`, value: b.text, inline: true },
      ];
    case "table":
      return [
        ...(b.caption ? [{ path: `${base}.caption`, value: b.caption, inline: false }] : []),
        ...b.head.map((v, i) => ({ path: `${base}.head.${i}`, value: v, inline: false })),
        ...b.rows.flatMap((r, ri) => r.map((v, ci) => ({ path: `${base}.rows.${ri}.${ci}`, value: v, inline: false }))),
      ];
    case "faq":
      return b.items.flatMap((it, i) => [
        { path: `${base}.items.${i}.q`, value: it.q, inline: false },
        { path: `${base}.items.${i}.a`, value: it.a, inline: true },
      ]);
    case "toolEmbed":
      return [];
  }
}

/**
 * Gövde doğrulaması. `pathPrefix`: hata yollarının öneki (ör. "body"). `extraPaths`: iç bağlantı sayılan ek yollar
 * (yayındaki rehber yazıları, kategori sayfaları).
 */
export function validateRichBody(
  input: unknown,
  opts: { pathPrefix?: string; extraPaths?: readonly string[] } = {},
): { blocks: RichBlock[] | null; issues: RichIssue[] } {
  const prefix = opts.pathPrefix ?? "body";
  const issues: RichIssue[] = [];
  const parsed = richBodySchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", path: [prefix, ...i.path].join("."), message: i.message });
    return { blocks: null, issues };
  }
  const blocks = parsed.data as RichBlock[];
  blocks.forEach((b, bi) => {
    for (const f of fieldsOf(b, `${prefix}.${bi}`)) {
      if (CONTROL_RE.test(f.value)) issues.push({ level: "error", path: f.path, message: "Görünmez denetim karakteri var; metni yeniden yazın." });
      if (HTML_TAG_RE.test(f.value)) issues.push({ level: "warn", path: f.path, message: "HTML etiketi işlenmez; metin olduğu gibi (düz yazı) görünür." });
      if (!f.inline) continue;
      for (const i of parseInline(f.value, { extraPaths: opts.extraPaths }).issues) issues.push({ level: i.level, path: f.path, message: i.message });
    }
  });
  return { blocks, issues };
}

export function richHasErrors(issues: readonly RichIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
