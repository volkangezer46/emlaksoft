import { cleanUtm } from "@/lib/growth/attribution";
import { getBaseUrl } from "@/lib/base-url";
import { now } from "@/lib/clock";
import { clientIpFromHeaders } from "@/lib/public-request-security";
import { BEACON_MAX_BYTES, parseBeacon } from "./beacon-schema";
import { recordPageview, recordVital } from "./buffer";
import { DEFAULT_OWN_HOSTS, classifyChannel } from "./channel";
import { beaconBucket } from "./rate-bucket";
import { pathTemplate } from "./scope";
import { MEASURE_DEFAULTS, getMeasureSettings } from "./settings";
import { bucketOf } from "./vitals";

/**
 * `/api/v` beacon işleyicisi (SUNUCU). Sıra (ucuzdan pahalıya; hiçbiri DB'ye gitmez):
 *  1) Content-Length > 4 KB → 413.
 *  2) Köken: `Sec-Fetch-Site: same-origin` ya da `Origin === SITE_ORIGIN`; değilse 204 (yazma yok).
 *  3) Bot kullanıcı aracısı, `Sec-Purpose/Purpose: prefetch`, `DNT: 1`, `Sec-GPC: 1` → sessizce 204.
 *  4) Süreç içi token kovası (IP yalnız bellekte anahtar) → aşımda 429.
 *  5) Gövde ≤4 KB okunur, zod ile doğrulanır; yol `pathTemplate` ile kapsam + şablon (kapsam dışı → 204).
 *  6) Sayaçlar tampona (buffer.ts) yazılır; DB'ye toplu yazım 15 sn'de bir arka planda.
 * Kişisel veri saklanmaz: IP/UA yalnız bu istekte bakılır; çerez okunmaz.
 */

export const BOT_UA =
  /bot|crawl|spider|slurp|archiver|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|curl|wget|python|httpclient|okhttp|axios|node-fetch|undici|go-http|java\/|libwww|scrapy|phantomjs|puppeteer|playwright|selenium/i;

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

function siteOrigin(): string | null {
  try {
    return new URL(getBaseUrl()).origin;
  } catch {
    return null;
  }
}

export function isSameOrigin(headers: Headers, origin: string | null = siteOrigin()): boolean {
  if (headers.get("sec-fetch-site") === "same-origin") return true;
  const o = headers.get("origin");
  return Boolean(origin && o && o === origin);
}

/** Sayılmaması gereken istek: bot, önceden yükleme, izleme istemiyorum (DNT/GPC). */
export function isIgnoredRequest(headers: Headers): boolean {
  const ua = headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) return true;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return true;
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}

/** Gövdeyi en çok `max` bayta kadar okur; aşarsa null. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function handleBeacon(req: Request): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BEACON_MAX_BYTES) return empty(413);
  const origin = siteOrigin();
  if (!isSameOrigin(req.headers, origin)) return empty(204);
  if (isIgnoredRequest(req.headers)) return empty(204);
  const t = now();
  if (!beaconBucket.take(clientIpFromHeaders(req.headers), t)) return empty(429);

  const text = await readCapped(req, BEACON_MAX_BYTES);
  if (text === null) return empty(413);
  const b = parseBeacon(text);
  if (!b) return empty(400);
  const tpl = pathTemplate(b.p);
  if (!tpl) return empty(204);

  const settings = await getMeasureSettings().catch(() => MEASURE_DEFAULTS);
  const device = b.d === "m" ? "mobile" : "desktop";
  if (b.n === 1 && settings.pageviews) {
    const source = cleanUtm(b.u?.s)?.slice(0, 32) ?? "";
    const medium = cleanUtm(b.u?.m)?.slice(0, 32) ?? "";
    const campaign = cleanUtm(b.u?.c)?.slice(0, 32) ?? "";
    const ownHost = origin ? new URL(origin).hostname : null;
    const channel = classifyChannel({
      refHost: b.r,
      utm_source: source,
      utm_medium: medium,
      ownHosts: ownHost ? [ownHost, ...DEFAULT_OWN_HOSTS] : DEFAULT_OWN_HOSTS,
    });
    recordPageview({ path_tpl: tpl, channel, source, medium, campaign, device }, t);
  }
  if (settings.vitals) {
    for (const [metric, value] of b.v) {
      const bucket = bucketOf(metric, value);
      if (bucket !== null) recordVital({ path_tpl: tpl, device, metric, bucket, static: b.s === 1 }, t);
    }
  }
  return empty(204);
}
