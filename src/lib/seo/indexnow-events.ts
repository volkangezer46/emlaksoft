import { createHash } from "node:crypto";
import { getBaseUrl } from "@/lib/base-url";
import { now, trDayKey } from "@/lib/clock";
import { discardExternalResponse, fetchExternal } from "@/lib/external-fetch";
import { INDEXNOW_DAILY_LIMIT, type IndexNowLogEntry } from "./schema";
import { canAutoOptimize, pathOfUrl } from "./scope";
import { appendIndexNowLog, readIndexNow, readIndexNowSeen, writeIndexNow, writeIndexNowSeen } from "./store";

/**
 * IndexNow OLAY bildirimi (yayın anı, Kokpit eylemi). Günlük robot sitemap farkını ayrıca gönderir (audit-runner.ts
 * runIndexNow); ikisi aynı günlük sayacı ve aynı "Son bildirimler" listesini (seo.indexnow.log, son 50) kullanır.
 *
 * Kurallar:
 *  - IndexNow KAPALIYSA hiçbir dış çağrı yapılmaz (varsayılan kapalı).
 *  - Yalnız kendi kökenimiz, `canAutoOptimize` true ve indekslenebilir (sitemap'te olan) adresler gönderilir.
 *  - Günlük sınır (2.000 URL) korunur. Dış POST yalnız `fetchExternal` ile (yönlendirme reddi + süre sınırı).
 * Not: Google IndexNow desteklemez; Bing, Yandex, Seznam, Naver ve diğerleri destekler.
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** `url|lastmod` parmak izi (seo.indexnow.seen). Günlük sitemap farkı (runIndexNow) ile olay bildirimi AYNI işlevi kullanır. */
export const indexNowPrint = (url: string, lastmod?: string) => createHash("sha1").update(`${url}|${lastmod ?? ""}`).digest("hex").slice(0, 10);

export type IndexNowEventOutcome = { sent: number; status: string; skipped?: string };

/**
 * Gönderilebilir adresler (SAF): aynı köken, otomatik iyileştirme kapsamında, indekslenebilir (sitemap anahtarlarında).
 * `sitemapPaths`: güncel sitemap'teki yollar (normalize). Yinelenenler atılır.
 */
export function indexNowEligible(urls: readonly string[], siteOrigin: string, sitemapPaths: ReadonlySet<string>): string[] {
  let origin: string;
  try {
    origin = new URL(siteOrigin).origin;
  } catch {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw, origin);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    const path = pathOfUrl(u.toString());
    if (path === null || !canAutoOptimize(path) || !sitemapPaths.has(path)) continue;
    const clean = `${origin}${path === "/" ? "" : path}`;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/** Tek POST (paylaşılan): sonucu "Son bildirimler" listesine yazar. Anahtar biçimi çağıranda doğrulanır. */
export async function postIndexNow(
  key: string,
  urls: readonly string[],
  source: IndexNowLogEntry["source"],
  nowMs: number,
): Promise<{ ok: boolean; status: string; httpStatus: number }> {
  const origin = getBaseUrl();
  const host = new URL(origin).host;
  let httpStatus = 0;
  let status = "bağlantı hatası";
  try {
    const res = await fetchExternal(
      INDEXNOW_ENDPOINT,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls }),
        cache: "no-store",
      },
      { timeoutMs: 10_000 },
    );
    await discardExternalResponse(res);
    httpStatus = res.status;
    status = `HTTP ${res.status}`;
  } catch {
    /* bağlantı hatası: durum 0 */
  }
  const at = new Date(nowMs).toISOString();
  await appendIndexNowLog(urls.slice(0, 50).map((url) => ({ url: url.slice(0, 500), at, status: httpStatus, source })));
  return { ok: httpStatus === 200 || httpStatus === 202, status, httpStatus };
}

/**
 * Yayın anı / Kokpit bildirimi. `sitemapPaths` verilmezse güncel sitemap okunur (indekslenebilirlik ölçütü).
 * KAPALIYKEN ya da gönderilecek adres yokken dış çağrı SIFIRDIR.
 */
export async function notifyIndexNow(
  urls: readonly string[],
  opts: { source: "yayin" | "elle"; sitemapPaths?: ReadonlySet<string>; nowMs?: number },
): Promise<IndexNowEventOutcome> {
  const s = await readIndexNow();
  if (!s.enabled) return { sent: 0, status: "kapalı", skipped: "IndexNow etkin değil" };
  if (!/^[a-f0-9]{32}$/.test(s.key)) return { sent: 0, status: "anahtar yok", skipped: "IndexNow anahtarı üretilmemiş" };

  let sitemapPaths = opts.sitemapPaths;
  // Yol -> sitemap girdisi: başarılı gönderimden sonra `url|lastmod` parmak izi "görüldü" kümesine yazılır; böylece
  // ertesi günkü sitemap farkı (runIndexNow) yayının değiştirdiği lastmod yüzünden aynı adresi YENİDEN göndermez.
  let byPath: Map<string, { url: string; lastModified?: string }> | null = null;
  if (!sitemapPaths) {
    const { loadSitemapFresh } = await import("./sitemap-data");
    const fresh = await loadSitemapFresh();
    byPath = new Map();
    for (const e of fresh.chunks.flat()) {
      const p = pathOfUrl(e.url);
      if (p !== null && !byPath.has(p)) byPath.set(p, e);
    }
    sitemapPaths = new Set(byPath.keys());
  }
  const eligible = indexNowEligible(urls, getBaseUrl(), sitemapPaths);
  if (eligible.length === 0) return { sent: 0, status: "gönderilecek adres yok", skipped: "Adresler kapsam dışı ya da indekslenmiyor" };

  const nowMs = opts.nowMs ?? now();
  const today = trDayKey(nowMs);
  const usedToday = s.dayKey === today ? s.dayCount : 0;
  const remaining = Math.max(0, INDEXNOW_DAILY_LIMIT - usedToday);
  if (remaining === 0) return { sent: 0, status: "günlük sınır doldu", skipped: "Günlük IndexNow sınırı doldu" };

  const batch = eligible.slice(0, remaining);
  const res = await postIndexNow(s.key, batch, opts.source, nowMs);
  if (res.ok && byPath) {
    const seen = await readIndexNowSeen();
    const before = seen.size;
    for (const u of batch) {
      const p = pathOfUrl(u);
      const e = p === null ? undefined : byPath.get(p);
      if (e) seen.add(indexNowPrint(e.url, e.lastModified));
    }
    if (seen.size !== before) await writeIndexNowSeen(seen);
  }
  await writeIndexNow({
    ...s,
    lastSentAt: new Date(nowMs).toISOString(),
    lastCount: res.ok ? batch.length : 0,
    lastStatus: res.status,
    dayKey: today,
    dayCount: usedToday + (res.ok ? batch.length : 0),
  });
  return { sent: res.ok ? batch.length : 0, status: res.status };
}
