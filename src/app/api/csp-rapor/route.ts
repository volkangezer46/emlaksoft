import { getBaseUrl } from "@/lib/base-url";
import { logError } from "@/lib/error-log";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/public-request-security";
import { now } from "@/lib/clock";
import { parseCspReports, violationDetail, violationMessage } from "@/lib/security/csp-report";

/**
 * CSP RAPOR UCU (yalnız ölçüm): tarayıcıların `Content-Security-Policy-Report-Only` ihlal raporlarını alır ve
 * error_logs'a (kaynak "csp") yazar. Politika: src/lib/security/csp-report-only.ts; başlığı proxy ekler (/app, /admin).
 *
 * Kötüye kullanım sınırları (uç oturumsuzdur; tarayıcı çerezsiz gönderir):
 *  - Gövde en çok 32 KB, istek başına en çok 20 rapor; yalnız bu sitenin belgelerinden gelen raporlar.
 *  - Süreç içi tekilleştirme: aynı ihlal 10 dakikada bir kez DB'ye iner (aradaki tekrarlar sayılmaz; ölçüm "hangi
 *    ihlaller var"ı gösterir, trafik sayacı değildir). Süreç başına dakikada en çok 30 yazım.
 *  - Yeni ihlal için IP başına DB hız sınırı (5 dk'da 30); altyapı hatasında yazım yapılmaz.
 * Her durumda 204 döner (tarayıcıya bilgi sızdırmaz, yeniden deneme tetiklemez).
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 32 * 1024;
const DEDUPE_MS = 10 * 60_000;
const WRITES_PER_MIN = 30;
const SEEN_MAX = 2_000;

const seen = new Map<string, number>();
let windowStart = 0;
let windowWrites = 0;

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

function takeWriteSlot(t: number): boolean {
  if (t - windowStart >= 60_000) {
    windowStart = t;
    windowWrites = 0;
  }
  if (windowWrites >= WRITES_PER_MIN) return false;
  windowWrites += 1;
  return true;
}

function isFresh(key: string, t: number): boolean {
  const last = seen.get(key);
  if (last !== undefined && t - last < DEDUPE_MS) return false;
  if (seen.size >= SEEN_MAX) {
    for (const [k, at] of seen) if (t - at >= DEDUPE_MS) seen.delete(k);
    if (seen.size >= SEEN_MAX) seen.clear();
  }
  seen.set(key, t);
  return true;
}

export async function POST(request: Request) {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!/application\/(csp-report|reports\+json|json)/.test(type)) return NO_CONTENT();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) return NO_CONTENT();
  const body = (await request.text().catch(() => "")).slice(0, MAX_BODY + 1);
  if (!body || body.length > MAX_BODY) return NO_CONTENT();

  const siteOrigin = new URL(getBaseUrl()).origin;
  const violations = parseCspReports(body, siteOrigin);
  if (violations.length === 0) return NO_CONTENT();

  const t = now();
  const fresh = violations.filter((v) => isFresh(violationMessage(v), t));
  if (fresh.length === 0) return NO_CONTENT();

  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimit(`csp-report:${ip}`, { limit: 30, windowSec: 300, failurePolicy: "deny" });
  if (!rate.allowed) return NO_CONTENT();

  const userAgent = request.headers.get("user-agent");
  for (const v of fresh) {
    if (!takeWriteSlot(t)) break;
    await logError({ source: "csp", message: violationMessage(v), stack: violationDetail(v), path: null, userAgent });
  }
  return NO_CONTENT();
}
