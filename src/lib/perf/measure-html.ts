import { gzipSync } from "node:zlib";

/**
 * HTML ölçümü (SAF; G/Ç yok): ham/gzip bayt ve betik sayıları. Hız ekranı, X-Static öz testi ve
 * `scripts/check-bundle-budget.ts` aynı ölçümü kullanır (gzip seviye 6 = Next/Traefik varsayılanına yakın).
 */
export type HtmlMeasure = {
  rawBytes: number;
  gzipBytes: number;
  /** `/_next/` adresli dış betik sayısı (statik sayfada 0 olmalı). */
  nextScripts: number;
  /** Tüm dış (`src=`) betikler. */
  externalScripts: number;
  /** Satır içi betikler (JSON-LD ve veri blokları dahil). */
  inlineScripts: number;
};

export function measureHtml(html: string): HtmlMeasure {
  let nextScripts = 0;
  let externalScripts = 0;
  let inlineScripts = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = /\ssrc=(?:"([^"]*)"|'([^']*)')/i.exec(m[1]);
    const url = src?.[1] ?? src?.[2];
    if (url === undefined) inlineScripts++;
    else {
      externalScripts++;
      if (/(^|\/)_next\//.test(url)) nextScripts++;
    }
  }
  return {
    rawBytes: Buffer.byteLength(html),
    gzipBytes: gzipSync(html, { level: 6 }).length,
    nextScripts,
    externalScripts,
    inlineScripts,
  };
}
