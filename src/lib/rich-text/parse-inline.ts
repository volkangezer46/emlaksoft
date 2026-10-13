import { checkRichHref } from "./href";

/**
 * Satır içi biçim ayrıştırıcısı (SAF, ham HTML YOK). Desteklenen sözdizimi yalnız:
 *   **kalın**   *italik*   [metin](href)   ve kaçış: \*  \[  \]  \(  \)  \\
 * Çıktı küçük bir AST'dir; renderer düğümleri React öğesine çevirir ve metni React kaçışlar (dangerouslySetInnerHTML yok).
 * Kapanmayan işaret düz metin kalır. Bağlantı adresi `checkRichHref`'ten geçmezse bağlantı DÜŞER (yalnız metni kalır) ve
 * hata kaydı üretilir; bilinmeyen iç yol uyarıdır. `<script>` gibi metinler yalnız metindir.
 */

export type InlineNode =
  | { t: "text"; v: string }
  | { t: "strong"; c: InlineNode[] }
  | { t: "em"; c: InlineNode[] }
  | { t: "link"; href: string; external: boolean; c: InlineNode[] };

export type InlineIssue = { level: "error" | "warn"; message: string };

export type InlineParse = { nodes: InlineNode[]; issues: InlineIssue[]; links: string[] };

type Ctx = { strong: boolean; em: boolean; link: boolean; extraPaths: readonly string[]; issues: InlineIssue[]; links: string[]; depth: number };

const ESCAPABLE = new Set(["*", "[", "]", "(", ")", "\\"]);
const MAX_DEPTH = 6;

/** `from`'dan sonra kaçışsız `token`'ın konumu (yoksa -1). `**` ararken tek `*` atlanmaz; tek `*` ararken `**` atlanır. */
function findClose(s: string, token: "**" | "*" | "]", from: number): number {
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1]!)) {
      i++;
      continue;
    }
    if (token === "**" && s.startsWith("**", i)) return i;
    if (token === "*" && ch === "*") {
      if (s[i + 1] === "*") {
        // Kalın içindeki italik değil, iç içe kalın: ikisini birlikte atla.
        const close = findClose(s, "**", i + 2);
        if (close === -1) return -1;
        i = close + 1;
        continue;
      }
      return i;
    }
    // Bağlantı metni tek düzeydir: ilk kaçışsız ']' bitiriştir.
    if (token === "]" && ch === "]") return i;
  }
  return -1;
}

function pushText(out: InlineNode[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

function parse(s: string, ctx: Ctx): InlineNode[] {
  const out: InlineNode[] = [];
  if (ctx.depth > MAX_DEPTH) {
    pushText(out, s);
    return out;
  }
  const inner = (sub: string, patch: Partial<Ctx>) => parse(sub, { ...ctx, ...patch, depth: ctx.depth + 1 });
  let i = 0;
  let buf = "";
  const flush = () => {
    pushText(out, buf);
    buf = "";
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === "*" && s[i + 1] === "*" && !ctx.strong) {
      const close = findClose(s, "**", i + 2);
      const body = close === -1 ? "" : s.slice(i + 2, close);
      if (close !== -1 && body.trim()) {
        flush();
        out.push({ t: "strong", c: inner(body, { strong: true }) });
        i = close + 2;
        continue;
      }
      buf += "**";
      i += 2;
      continue;
    }
    if (ch === "*" && s[i + 1] !== "*" && !ctx.em) {
      const close = findClose(s, "*", i + 1);
      const body = close === -1 ? "" : s.slice(i + 1, close);
      if (close !== -1 && body.trim() && !/^\s/.test(body)) {
        flush();
        out.push({ t: "em", c: inner(body, { em: true }) });
        i = close + 1;
        continue;
      }
      buf += "*";
      i += 1;
      continue;
    }
    if (ch === "[" && !ctx.link) {
      const closeText = findClose(s, "]", i + 1);
      if (closeText !== -1 && s[closeText + 1] === "(") {
        const closeHref = s.indexOf(")", closeText + 2);
        const text = s.slice(i + 1, closeText);
        if (closeHref !== -1 && text.trim()) {
          const rawHref = s.slice(closeText + 2, closeHref);
          flush();
          const children = inner(text, { link: true });
          const r = checkRichHref(rawHref, ctx.extraPaths);
          if (r.ok) {
            out.push({ t: "link", href: r.href, external: r.external, c: children });
            ctx.links.push(r.href);
            if (r.broken || r.warn) ctx.issues.push({ level: "warn", message: r.warn ?? "Kırık iç bağlantı." });
          } else {
            // Güvensiz/geçersiz adres: bağlantı düşer, yalnız metni kalır.
            for (const n of children) {
              if (n.t === "text") pushText(out, n.v);
              else out.push(n);
            }
            ctx.issues.push({ level: "error", message: `Bağlantı kabul edilmedi (${rawHref.slice(0, 60)}): ${r.message}` });
          }
          i = closeHref + 1;
          continue;
        }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

export function parseInline(src: string, opts: { extraPaths?: readonly string[] } = {}): InlineParse {
  const issues: InlineIssue[] = [];
  const links: string[] = [];
  const nodes = parse(String(src ?? ""), { strong: false, em: false, link: false, extraPaths: opts.extraPaths ?? [], issues, links, depth: 0 });
  return { nodes, issues, links };
}

/** Düz metin (okuma süresi, özet, RSS açıklaması). */
export function inlineToPlain(nodes: readonly InlineNode[]): string {
  let out = "";
  for (const n of nodes) out += n.t === "text" ? n.v : inlineToPlain(n.c);
  return out;
}

/** Biçimli kaynaktan düz metin. */
export function plainInline(src: string): string {
  return inlineToPlain(parseInline(src).nodes);
}
