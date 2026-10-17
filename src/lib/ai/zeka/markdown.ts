/**
 * Zeka yanıt metni için GÜVENLİ, hafif markdown (SAF, bağımlılıksız). HTML ÜRETMEZ: metni düz bir ağaca çevirir, React
 * bileşeni bunu öğelerle çizer (dangerouslySetInnerHTML yok; `<script>` gibi her şey düz metin kalır).
 * Desteklenen: paragraf (tek satır sonu korunur), `- ` / `* ` / `• ` madde listesi, `1. ` / `1) ` sıralı liste,
 * `**kalın**`, `` `kod` `` ve `[etiket](/site-ici/yol)`. Bağlantı YALNIZ site içi yola gider (`/` ile başlar; `//`, `\`,
 * şema, boşluk ve denetim karakteri yok); aksi hâlde yalnız etiket düz metin olarak kalır.
 */

export type ZekaInline =
  | { t: "text"; v: string }
  | { t: "bold"; v: ZekaInline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; v: string }
  | { t: "br" };

export type ZekaBlock = { t: "p"; v: ZekaInline[] } | { t: "ul"; items: ZekaInline[][] } | { t: "ol"; items: ZekaInline[][]; start: number };

const MAX_INPUT = 8_000;

/** Site içi yol mu? (kök göreli yol ve sorgu dizesi evet; `//`, ters bölü, `javascript:`, `https://` hayır.) */
export function isInternalHref(href: string): boolean {
  if (typeof href !== "string" || href.length > 500) return false;
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return false;
  if (/[\s\\\u0000-\u001f\u007f<>"'`]/.test(href)) return false;
  const path = href.split(/[?#]/)[0]!;
  return !path.includes(":");
}

const INLINE = /\*\*([^*\n]{1,300})\*\*|`([^`\n]{1,200})`|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;

export function parseInline(text: string, depth = 0): ZekaInline[] {
  const out: ZekaInline[] = [];
  const pushText = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    pushText(text.slice(i, at));
    if (m[1] !== undefined) {
      if (depth < 1) out.push({ t: "bold", v: parseInline(m[1], depth + 1) });
      else pushText(m[1]);
    } else if (m[2] !== undefined) {
      out.push({ t: "code", v: m[2] });
    } else if (m[3] !== undefined && m[4] !== undefined) {
      if (isInternalHref(m[4])) out.push({ t: "link", href: m[4], v: m[3] });
      else pushText(m[3]);
    }
    i = at + m[0].length;
  }
  pushText(text.slice(i));
  return out;
}

const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*(\d{1,3})[.)]\s+(.*)$/;

function inlineLines(lines: string[]): ZekaInline[] {
  const out: ZekaInline[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push({ t: "br" });
    out.push(...parseInline(l));
  });
  return out;
}

export function parseZekaMarkdown(input: string): ZekaBlock[] {
  const text = String(input ?? "").slice(0, MAX_INPUT).replace(/\r\n?/g, "\n");
  const blocks: ZekaBlock[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[]; start: number } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", v: inlineLines(para) });
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((s) => parseInline(s));
    blocks.push(list.kind === "ul" ? { t: "ul", items } : { t: "ol", items, start: list.start });
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [], start: ol ? Number(ol[1]) || 1 : 1 };
      }
      list.items.push((ul ? ul[1] : ol![2])!.trim());
      continue;
    }
    if (list) flushList();
    // Başlık işaretleri (#) düz metne iner.
    para.push(line.replace(/^\s{0,3}#{1,6}\s+/, ""));
  }
  flushPara();
  flushList();
  return blocks;
}

/** Kopyalama için düz metin (işaretler atılır, bağlantının etiketi kalır). */
export function zekaPlainText(input: string): string {
  return String(input ?? "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1")
    .trim();
}
