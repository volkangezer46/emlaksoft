import { getBaseUrl } from "@/lib/base-url";
import { logError } from "@/lib/error-log";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders, readRequestBodyLimited, requestBodyTooLarge } from "@/lib/public-request-security";
import { now } from "@/lib/clock";
import { parseCspReports, violationDetail, violationMessage, type CspViolation } from "@/lib/security/csp-report";

/**
 * CSP RAPOR UCU (yalnız ölçüm): tarayıcıların `Content-Security-Policy-Report-Only` ihlal raporlarını alır ve
 * error_logs'a (kaynak "csp") yazar. Politika: src/lib/security/csp-report-only.ts; başlığı proxy ekler (/app, /admin).
 *
 * Kötüye kullanım sınırları (uç oturumsuzdur, tarayıcı çerezsiz gönderir; rapor içeriği UYDURULABİLİR):
 *  - Gövde gerçekten en çok 32 KB okunur (Content-Length'siz parçalı gövde dahil), istek başına en çok 20 rapor;
 *    yalnız bu sitenin belgeleri ve bilinen yönergeler (csp-report.ts).
 *  - Süreç içi tekilleştirme: aynı ihlal 10 dakikada bir kez DB'ye iner (aradaki tekrarlar sayılmaz; ölçüm "hangi
 *    ihlaller var"ı gösterir, trafik sayacı değildir). İhlal yalnız gerçekten YAZILINCA işaretlenir: hız sınırına
 *    takılan ya da bütçe dışı kalan rapor, gerçek bir ihlali 10 dakika susturamaz.
 *  - Süreç başına dakikada en çok 30 yazım; bunların içinde daha önce görülmemiş (yeni satır açacak) ihlal saatte en
 *    çok 60: sahte raporla error_logs'a sınırsız farklı satır açılamaz. Bütçe doluysa DB'ye hiç gidilmez.
 *  - Yeni yazım için IP başına DB hız sınırı (5 dk'da 30); altyapı hatasında yazım yapılmaz.
 * Her durumda 204 döner (tarayıcıya bilgi sızdırmaz, yeniden deneme tetiklemez).
 * Bu satırlar "Açık hata" sayılarına girmez (Sistem > Hatalar'da ayrı "CSP ölçümü" süzgeci).
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 32 * 1024;
const DEDUPE_MS = 10 * 60_000;
const WRITES_PER_MIN = 30;
const NEW_PER_HOUR = 60;
/** Yazılmış ihlal bu süre "bilinen" sayılır (sonraki yazımı yeni satır bütçesinden düşmez). */
const KNOWN_TTL_MS = 24 * 60 * 60_000;
const KNOWN_MAX = 2_000;

/** İhlal mesajı → son DB yazımı (yalnız yazılanlar; ekleme sırası = yaşa göre sıra). */
const written = new Map<string, number>();
const minute = { start: 0, used: 0 };
const hour = { start: 0, used: 0 };

const NO_CONTENT = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

function roll(w: { start: number; used: number }, t: number, spanMs: number) {
  if (t - w.start >= spanMs) {
    w.start = t;
    w.used = 0;
  }
}

function isDue(key: string, t: number): boolean {
  const last = written.get(key);
  return last === undefined || t - last >= DEDUPE_MS;
}

function isNew(key: string, t: number): boolean {
  const last = written.get(key);
  return last === undefined || t - last >= KNOWN_TTL_MS;
}

/** Bütçe bu istekteki adaylardan en az birine yetiyor mu? (Yetmiyorsa IP hız sınırı için DB'ye gidilmez.) */
function canWriteAny(keys: readonly string[], t: number): boolean {
  roll(minute, t, 60_000);
  roll(hour, t, 3_600_000);
  if (minute.used >= WRITES_PER_MIN) return false;
  return hour.used < NEW_PER_HOUR || keys.some((k) => !isNew(k, t));
}

function remember(key: string, t: number) {
  written.delete(key);
  if (written.size >= KNOWN_MAX) {
    for (const [k, at] of written) if (t - at >= KNOWN_TTL_MS) written.delete(k);
    for (const k of written.keys()) {
      if (written.size < KNOWN_MAX) break;
      written.delete(k);
    }
  }
  written.set(key, t);
}

/** Yazım hakkı (eşzamanlı isteklerde yeniden denetlenir); alınırsa ihlal "yazıldı" işaretlenir. */
function takeWriteSlot(key: string, t: number): boolean {
  roll(minute, t, 60_000);
  roll(hour, t, 3_600_000);
  if (!isDue(key, t) || minute.used >= WRITES_PER_MIN) return false;
  const fresh = isNew(key, t);
  if (fresh && hour.used >= NEW_PER_HOUR) return false;
  minute.used += 1;
  if (fresh) hour.used += 1;
  remember(key, t);
  return true;
}

export async function POST(request: Request) {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!/application\/(csp-report|reports\+json|json)/.test(type)) return NO_CONTENT();
  if (requestBodyTooLarge(request.headers, MAX_BODY)) return NO_CONTENT();
  const bytes = await readRequestBodyLimited(request, MAX_BODY).catch(() => null);
  if (!bytes || bytes.byteLength === 0) return NO_CONTENT();

  const siteOrigin = new URL(getBaseUrl()).origin;
  const violations = parseCspReports(new TextDecoder().decode(bytes), siteOrigin);
  if (violations.length === 0) return NO_CONTENT();

  const t = now();
  // İstek içi tekrarlar bir kez; 10 dakika içinde yazılmış ihlal DB'ye inmez.
  const due = new Map<string, CspViolation>();
  for (const v of violations) {
    const key = violationMessage(v);
    if (!due.has(key) && isDue(key, t)) due.set(key, v);
  }
  if (due.size === 0 || !canWriteAny([...due.keys()], t)) return NO_CONTENT();

  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimit(`csp-report:${ip}`, { limit: 30, windowSec: 300, failurePolicy: "deny" });
  if (!rate.allowed) return NO_CONTENT();

  const userAgent = request.headers.get("user-agent");
  for (const [message, v] of due) {
    if (!takeWriteSlot(message, t)) continue;
    await logError({ source: "csp", message, stack: violationDetail(v), path: null, userAgent });
  }
  return NO_CONTENT();
}
