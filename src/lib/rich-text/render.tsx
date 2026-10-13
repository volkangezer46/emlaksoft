import type { ReactNode } from "react";
import { getPublishedTool } from "@/lib/tools/registry";
import { CALLOUT_TONE_LABEL, headingIds, type CalloutTone, type RichBlock } from "./core";
import { parseInline, type InlineNode } from "./parse-inline";

/**
 * Zengin metin renderer'ı (sunucu bileşeni; kanca/istemci kodu YOK). Bloklar ve satır içi AST React öğesine çevrilir;
 * metin her zaman React tarafından kaçışlanır. `dangerouslySetInnerHTML` KULLANILMAZ (sözleşme testi). Bağlantı adresi
 * yalnız ayrıştırıcının `checkRichHref` kapısından geçmiş hâlidir; dış bağlantı `rel="noopener nofollow"` alır.
 * Bağlantılar düz `<a>`: next/link istemci bileşenidir, herkese açık rehber sayfasına istemci JS'i taşımaz.
 */

export function renderInline(nodes: readonly InlineNode[], keyPrefix = "i"): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (n.t) {
      case "text":
        return n.v;
      case "strong":
        return <strong key={key}>{renderInline(n.c, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(n.c, key)}</em>;
      case "link":
        return n.external ? (
          <a key={key} href={n.href} rel="noopener nofollow" target="_blank" className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-600">
            {renderInline(n.c, key)}
          </a>
        ) : (
          <a key={key} href={n.href} className="font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-600">
            {renderInline(n.c, key)}
          </a>
        );
    }
  });
}

/** Biçimli metni satır içi öğelere çevirir. */
export function Inline({ text, extraPaths }: { text: string; extraPaths?: readonly string[] }) {
  return <>{renderInline(parseInline(text, { extraPaths }).nodes)}</>;
}

const CALLOUT_CLASS: Record<CalloutTone, string> = {
  bilgi: "border-brand-300 bg-brand-50 text-ink-950",
  ipucu: "border-mint-300 bg-mint-50 text-ink-950",
  uyari: "border-amber-300 bg-amber-50 text-amber-900",
};

function Block({ block: b, id, extraPaths }: { block: RichBlock; id?: string; extraPaths?: readonly string[] }) {
  switch (b.type) {
    case "p":
      return b.text.trim() ? (
        <p className="leading-relaxed">
          <Inline text={b.text} extraPaths={extraPaths} />
        </p>
      ) : null;
    case "h2":
      return (
        <h2 id={id} className="scroll-mt-24 pt-4 font-display text-2xl font-extrabold text-ink-950">
          {b.text}
        </h2>
      );
    case "h3":
      return (
        <h3 id={id} className="scroll-mt-24 pt-2 font-display text-lg font-bold text-ink-950">
          {b.text}
        </h3>
      );
    case "ul":
    case "ol": {
      const Tag = b.type;
      return (
        <Tag className={`space-y-1.5 pl-6 leading-relaxed ${b.type === "ul" ? "list-disc" : "list-decimal"}`}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Inline text={it} extraPaths={extraPaths} />
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <figure className="border-l-4 border-brand-400 pl-4">
          <blockquote className="text-lg italic leading-relaxed text-ink-950">
            <Inline text={b.text} extraPaths={extraPaths} />
          </blockquote>
          {b.cite ? <figcaption className="mt-2 text-sm text-text-muted">— {b.cite}</figcaption> : null}
        </figure>
      );
    case "callout":
      return (
        <aside aria-label={b.title || CALLOUT_TONE_LABEL[b.tone]} className={`rounded-[var(--radius-panel)] border p-4 ${CALLOUT_CLASS[b.tone]}`}>
          <p className="text-sm font-bold">{b.title || CALLOUT_TONE_LABEL[b.tone]}</p>
          <p className="mt-1 leading-relaxed">
            <Inline text={b.text} extraPaths={extraPaths} />
          </p>
        </aside>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
          <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
            {b.caption ? <caption className="px-3 py-2 text-left text-sm font-semibold text-ink-950">{b.caption}</caption> : null}
            <thead className="bg-surface-2">
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className="border-b border-line px-3 py-2 font-semibold text-ink-950">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="border-b border-line last:border-0">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "faq":
      return (
        <div className="divide-y divide-line rounded-[var(--radius-panel)] border border-line">
          {b.items.map((it, i) => (
            <details key={i} className="group px-4 py-3">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink-950">{it.q}</summary>
              <p className="mt-2 leading-relaxed text-text-muted">
                <Inline text={it.a} extraPaths={extraPaths} />
              </p>
            </details>
          ))}
        </div>
      );
    case "toolEmbed": {
      const tool = getPublishedTool(b.slug);
      if (!tool) return null;
      return (
        <a
          href={`/araclar/${tool.slug}`}
          className="flex flex-col gap-1 rounded-[var(--radius-panel)] border border-brand-300 bg-brand-50 p-4 transition hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-brand-700">Ücretsiz araç</span>
          <span className="font-display text-lg font-bold text-ink-950">{tool.title}</span>
          <span className="text-sm text-text-muted">{tool.description}</span>
          <span className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">Hesaplayın →</span>
        </a>
      );
    }
  }
}

/** Gövdenin tamamı. Başlık kimlikleri içindekiler (tocOf) ile aynı sırayla üretilir. */
export function RichText({ blocks, extraPaths, className }: { blocks: readonly RichBlock[]; extraPaths?: readonly string[]; className?: string }) {
  const ids = headingIds(blocks);
  return (
    <div className={className ?? "space-y-5 text-base text-text"}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} id={ids[i]} extraPaths={extraPaths} />
      ))}
    </div>
  );
}
