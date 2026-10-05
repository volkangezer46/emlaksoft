import "server-only";

import { now } from "@/lib/clock";
import {
  discardExternalResponse,
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
} from "@/lib/external-fetch";
import { normalizeProviderBaseUrl, PROVIDER_REQUEST_TIMEOUT_MS } from "@/lib/integrations/provider-url";
import {
  classifyOrtakStatus,
  EMLAKFIYATI_ORTAK_JSON_MAX_BYTES,
  EMLAKFIYATI_ORTAK_MAX_PDF_CONCURRENCY,
  EMLAKFIYATI_ORTAK_MAX_VALUATION_CONCURRENCY,
  EMLAKFIYATI_ORTAK_PDF_MAX_BYTES,
  EMLAKFIYATI_ORTAK_TIMEOUT_MS,
  extractOrtakErrorCode,
  ortakRetryDelayMs,
  parseRetryAfterSeconds,
  sanitizeRequestId,
  type OrtakErrorKind,
} from "./ortak-contract";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { EF_SETTING, invalidateEmlakFiyatiKeyCache, resolveEmlakFiyatiKeys } from "./keys";
import {
  assertAllowedOutbound,
  backoffDelayMs,
  buildEmlakFiyatiHeaders,
  buildEmlakFiyatiPublicHeaders,
  classifyStatus,
  cooldownMs,
  EMLAKFIYATI_BASE_URL,
  EMLAKFIYATI_MAX_CONCURRENCY,
  EmlakFiyatiPolicyError,
  isAllowedOrtakPath,
  isAllowedPath,
  isAllowedReferencePath,
  validateQuery,
  type EmlakFiyatiErrorKind,
  type EmlakFiyatiGetPath,
  type EmlakFiyatiQuery,
} from "./policy";

/**
 * EmlakFiyati TEK ADAPTÖR — emlakfiyati.com'a giden TÜM çağrılar buradan geçer.
 *
 * - Taban adres https://emlakfiyati.com; kimlik YALNIZ `Authorization: Bearer` (başka kimlik başlığı kabul edilmez).
 * - Anahtar çözümleme: admin (şifreli) > ortam değişkeni > yok (bkz. keys.ts). Anahtar tarayıcıya/loga/hataya/sonuca GİRMEZ.
 * - Hız sınırı 120/dk/anahtar; aşılınca 429 ve Retry-After YOK: üstel geri çekilme + jitter, en çok 4 eşzamanlı istek,
 *   aynı sorgu için bellek önbelleği + eşzamanlı aynı istek birleştirme.
 * - 401 = anahtar geçersiz/iptal: OTOMATİK YENİDEN DENEME YOK (yalnız geçerli `previous` ile BİR kez), alarm üretilir.
 *   403 = kapsam yok. 429 = bekle. 5xx/ağ = sınırlı yeniden deneme.
 * - Kontör mantığı BU MODÜLÜN DIŞINDADIR; `onEmlakFiyatiRequest` ile yalnız "istek yapıldı" olayları dışarı verilir.
 * - Parametre şeması YALNIZ /api/endeks için doğrulandı; diğer uçlar için burada yalnız tür-güvenli `get(path, query)` vardır.
 */

const MAX_RETRIES = 2;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const AUTH_BLOCK_MS = 5 * 60 * 1000;
const PERSIST_THROTTLE_MS = 10 * 60 * 1000;
const NOTIFY_THROTTLE_MS = 60 * 60 * 1000;
const ADMIN_HREF = "/admin/sistem?sekme=emlakfiyati";

/** Tek izinli kök (https + emlakfiyati.com); başka host/şema fail-closed. */
const ALLOWED_ORIGIN = normalizeProviderBaseUrl(EMLAKFIYATI_BASE_URL, ["emlakfiyati.com"]);

// --- Sonuç / olay tipleri ---------------------------------------------------------------------------------------------

export type EmlakFiyatiResult<T = unknown> =
  | { ok: true; status: number; data: T; cached: boolean }
  | { ok: false; kind: EmlakFiyatiErrorKind; status?: number };

/** Kontör/ölçüm kancası için olay: anahtar, sorgu değeri veya yanıt gövdesi İÇERMEZ. */
export type EmlakFiyatiRequestEvent = {
  path: EmlakFiyatiGetPath;
  status: number | null;
  outcome: "ok" | EmlakFiyatiErrorKind;
  durationMs: number;
  viaPreviousKey: boolean;
};

type Listener = (event: EmlakFiyatiRequestEvent) => void;
const listeners = new Set<Listener>();

/** Her GERÇEK ağ isteğinden sonra çağrılır (önbellek isabeti sayılmaz). Aboneliği iptal eden işlev döner. */
export function onEmlakFiyatiRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const stats = { total: 0, byOutcome: {} as Record<string, number>, cacheHits: 0 };

export function getEmlakFiyatiRequestStats(): { total: number; cacheHits: number; byOutcome: Record<string, number> } {
  return { total: stats.total, cacheHits: stats.cacheHits, byOutcome: { ...stats.byOutcome } };
}

function emit(event: EmlakFiyatiRequestEvent): void {
  stats.total += 1;
  stats.byOutcome[event.outcome] = (stats.byOutcome[event.outcome] ?? 0) + 1;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Kanca hatası adaptörü etkilemez.
    }
  }
}

// --- Test kancaları -----------------------------------------------------------------------------------------------------

let sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let randomImpl: () => number = Math.random;

export function __setEmlakFiyatiAdapterTestHooks(hooks: { sleep?: (ms: number) => Promise<void>; random?: () => number }): void {
  if (hooks.sleep) sleepImpl = hooks.sleep;
  if (hooks.random) randomImpl = hooks.random;
}

// --- Eşzamanlılık sınırlayıcı (en çok 4) -----------------------------------------------------------------------------

let active = 0;
let peakActive = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < EMLAKFIYATI_MAX_CONCURRENCY) {
    active += 1;
    peakActive = Math.max(peakActive, active);
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  // Sıra devredildi: `active` sayacı zaten bu çağrıya aktarıldı.
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    next();
    return;
  }
  active -= 1;
}

export function getEmlakFiyatiPeakConcurrency(): number {
  return peakActive;
}

// --- Bellek durumu --------------------------------------------------------------------------------------------------------

type CacheEntry = { expires: number; status: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<EmlakFiyatiResult>>();
const authBlockedUntil = new Map<string, number>(); // anahtar parmak izi -> süre
const preferPrevious = new Set<string>(); // current parmak izi: current reddedildi, previous çalışıyor
let cooldownUntil = 0;
let consecutive429 = 0;
const persistedAt = new Map<string, number>();
let lastNotifyAt = 0;
let lastPreviousNoticeAt = 0;

/** Test yardımcısı: bellek içi durumu sıfırlar. */
export function resetEmlakFiyatiStateForTests(): void {
  cache.clear();
  inflight.clear();
  authBlockedUntil.clear();
  preferPrevious.clear();
  persistedAt.clear();
  cooldownUntil = 0;
  consecutive429 = 0;
  lastNotifyAt = 0;
  lastPreviousNoticeAt = 0;
  active = 0;
  peakActive = 0;
  waiters.length = 0;
  stats.total = 0;
  stats.cacheHits = 0;
  stats.byOutcome = {};
  listeners.clear();
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  randomImpl = Math.random;
  resetOrtakStateForTests();
}

// --- Kalıcı gözlem (platform_settings; en iyi çaba, asla çağrıyı bozmaz) -------------------------------------------

function throttled(name: string): boolean {
  const t = now();
  const last = persistedAt.get(name) ?? 0;
  if (t - last < PERSIST_THROTTLE_MS) return true;
  persistedAt.set(name, t);
  return false;
}

async function recordLastSuccess(force = false): Promise<void> {
  if (!force && throttled("ok")) return;
  try {
    await Promise.all([
      setPlatformSetting(EF_SETTING.lastOkAt, new Date(now()).toISOString()),
      setPlatformSetting(EF_SETTING.lastErrorClass, null),
      setPlatformSetting(EF_SETTING.lastErrorAt, null),
    ]);
  } catch {
    // Gözlem amaçlı.
  }
}

async function recordError(kind: EmlakFiyatiErrorKind): Promise<void> {
  if (kind === "disabled" || kind === "not_found") return;
  if (throttled(`err:${kind}`)) return;
  try {
    await Promise.all([
      setPlatformSetting(EF_SETTING.lastErrorClass, kind),
      setPlatformSetting(EF_SETTING.lastErrorAt, new Date(now()).toISOString()),
    ]);
  } catch {
    // Gözlem amaçlı.
  }
}

/** Platform ekranı için son başarılı API çağrısının ISO zamanı (yoksa null). */
export async function getEmlakFiyatiLastSuccessAt(): Promise<string | null> {
  const value = await getPlatformSetting(EF_SETTING.lastOkAt);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

/** Bir anahtar tanımlı mı (admin veya ortam); değeri ASLA dışarı vermez. */
export async function isEmlakFiyatiConfigured(): Promise<boolean> {
  if (!ALLOWED_ORIGIN) return false;
  return (await resolveEmlakFiyatiKeys()).current != null;
}

// --- 401 alarmı ---------------------------------------------------------------------------------------------------------

async function raiseAuthAlarm(): Promise<void> {
  await recordError("auth");
  const t = now();
  if (t - lastNotifyAt < NOTIFY_THROTTLE_MS) return;
  lastNotifyAt = t;
  try {
    const persisted = await getPlatformSetting(EF_SETTING.alarmNotifiedAt);
    const persistedMs = persisted ? new Date(persisted).getTime() : 0;
    if (persistedMs && t - persistedMs < NOTIFY_THROTTLE_MS) return;
    await setPlatformSetting(EF_SETTING.alarmNotifiedAt, new Date(t).toISOString());
    await notifyPlatformStaff({
      roles: ["super_admin"],
      kind: "danger",
      title: "EmlakFiyati API anahtarı reddedildi (401)",
      body: "Anahtar geçersiz ya da iptal edilmiş. EmlakFiyati istekleri durduruldu; Sistem > EmlakFiyati sekmesinden yeni anahtar girin.",
      href: ADMIN_HREF,
      meta: { source: "emlakfiyati", class: "auth" },
    });
  } catch {
    // Alarm üretimi hatası çağrıyı etkilemez.
  }
}

async function noticePreviousKeyUsed(): Promise<void> {
  const t = now();
  if (t - lastPreviousNoticeAt < NOTIFY_THROTTLE_MS) return;
  lastPreviousNoticeAt = t;
  try {
    await setPlatformSetting(EF_SETTING.previousUsedAt, new Date(t).toISOString());
    await notifyPlatformStaff({
      roles: ["super_admin"],
      kind: "warning",
      title: "EmlakFiyati: güncel anahtar reddedildi, eski anahtar kullanılıyor",
      body: "Güncel anahtar 401 aldı; eski (rotasyon) anahtar geçerli olduğu sürece çalışıyor. Anahtarı kontrol edin.",
      href: ADMIN_HREF,
      meta: { source: "emlakfiyati", class: "previous_key_used" },
    });
  } catch {
    // Uyarı üretimi hatası çağrıyı etkilemez.
  }
}

// --- Tek ağ denemesi ---------------------------------------------------------------------------------------------------

type Attempt =
  | { ok: true; status: number; data: unknown }
  | { ok: false; kind: EmlakFiyatiErrorKind; status?: number };

async function singleAttempt(
  url: string,
  apiKey: string,
  path: EmlakFiyatiGetPath,
  maxBytes: number,
  viaPreviousKey: boolean,
): Promise<Attempt> {
  const headers = buildEmlakFiyatiHeaders(apiKey);
  assertAllowedOutbound(url, headers); // beyaz liste: fırlatırsa ağa ÇIKILMAZ
  const startedAt = now();
  await acquire();
  let result: Attempt;
  try {
    const res = await fetchExternal(url, { method: "GET", headers, cache: "no-store" }, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS });
    const cls = classifyStatus(res.status);
    if (cls === "ok") {
      try {
        const data = await readExternalJson<unknown>(res, maxBytes);
        result = { ok: true, status: res.status, data };
      } catch (error) {
        console.error("EmlakFiyati yanıtı okunamadı", externalErrorMetadata(error));
        result = { ok: false, kind: "invalid_response", status: res.status };
      }
    } else {
      await discardExternalResponse(res);
      result = { ok: false, kind: cls, status: res.status };
    }
  } catch (error) {
    console.error("EmlakFiyati isteği başarısız", externalErrorMetadata(error));
    result = { ok: false, kind: "network" };
  } finally {
    release();
  }
  emit({
    path,
    status: result.ok ? result.status : (result.status ?? null),
    outcome: result.ok ? "ok" : result.kind,
    durationMs: now() - startedAt,
    viaPreviousKey,
  });
  return result;
}

async function attemptWithRetries(
  url: string,
  apiKey: string,
  path: EmlakFiyatiGetPath,
  maxBytes: number,
  viaPreviousKey: boolean,
): Promise<Attempt> {
  let last: Attempt = { ok: false, kind: "network" };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    last = await singleAttempt(url, apiKey, path, maxBytes, viaPreviousKey);
    const retryable = !last.ok && (last.kind === "rate_limited" || last.kind === "server" || last.kind === "network");
    if (!retryable || attempt === MAX_RETRIES) break;
    await sleepImpl(backoffDelayMs(attempt, randomImpl));
  }
  return last;
}

// --- Genel çekirdek -----------------------------------------------------------------------------------------------------

export type EmlakFiyatiGetOptions = {
  /** Aynı sorgu için bellek önbelleği süresi (ms). 0 = kapalı. Varsayılan 5 dk. */
  cacheTtlMs?: number;
  maxBytes?: number;
};

function cacheKeyOf(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

function remember(key: string, entry: CacheEntry): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

async function execute(
  path: EmlakFiyatiGetPath,
  params: URLSearchParams,
  maxBytes: number,
  cacheTtlMs: number,
  cacheKey: string,
): Promise<EmlakFiyatiResult> {
  if (!ALLOWED_ORIGIN) return { ok: false, kind: "disabled" };
  const keys = await resolveEmlakFiyatiKeys();
  if (!keys.current) return { ok: false, kind: "disabled" };

  const t = now();
  if ((authBlockedUntil.get(keys.fingerprint) ?? 0) > t) return { ok: false, kind: "auth", status: 401 };
  if (cooldownUntil > t) return { ok: false, kind: "rate_limited", status: 429 };

  const url = new URL(path, EMLAKFIYATI_BASE_URL);
  url.search = params.toString();
  const target = url.toString();

  const usePreviousFirst = Boolean(keys.previous) && preferPrevious.has(keys.fingerprint);
  const first = usePreviousFirst ? (keys.previous as string) : keys.current;
  let out = await attemptWithRetries(target, first, path, maxBytes, usePreviousFirst);

  if (!out.ok && out.kind === "auth" && !usePreviousFirst) {
    if (keys.previous) {
      // Geçerli eski anahtar varsa BİR kez onunla denenir.
      const viaPrevious = await attemptWithRetries(target, keys.previous, path, maxBytes, true);
      if (viaPrevious.ok) {
        preferPrevious.add(keys.fingerprint);
        void noticePreviousKeyUsed();
        out = viaPrevious;
      } else {
        out = viaPrevious.kind === "auth" ? { ok: false, kind: "auth", status: 401 } : viaPrevious;
      }
    }
  }

  if (out.ok) {
    consecutive429 = 0;
    void recordLastSuccess();
    if (cacheTtlMs > 0) remember(cacheKey, { expires: now() + cacheTtlMs, status: out.status, data: out.data });
    return { ok: true, status: out.status, data: out.data, cached: false };
  }

  if (out.kind === "auth") {
    authBlockedUntil.set(keys.fingerprint, now() + AUTH_BLOCK_MS);
    await raiseAuthAlarm();
    return { ok: false, kind: "auth", status: 401 };
  }
  if (out.kind === "rate_limited") {
    consecutive429 += 1;
    cooldownUntil = now() + cooldownMs(consecutive429, randomImpl);
  }
  void recordError(out.kind);
  return out.status === undefined ? { ok: false, kind: out.kind } : { ok: false, kind: out.kind, status: out.status };
}

/**
 * Tür-güvenli ince GET çekirdeği. Yol yalnız izinli listeden; sorgu değerleri doğrulanır (e-posta/uzun rakam dizisi reddedilir).
 * Hata olsa FIRLATMAZ: `{ ok:false, kind }`. Hiçbir sonuç/hata nesnesi anahtar içermez.
 */
export async function emlakFiyatiGet(
  path: EmlakFiyatiGetPath,
  query?: EmlakFiyatiQuery,
  options: EmlakFiyatiGetOptions = {},
): Promise<EmlakFiyatiResult> {
  let params: URLSearchParams;
  try {
    if (!isAllowedPath(path)) throw new EmlakFiyatiPolicyError("path");
    params = validateQuery(query);
  } catch {
    return { ok: false, kind: "disabled" };
  }
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheKey = cacheKeyOf(path, params);

  if (ttl > 0) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > now()) {
      stats.cacheHits += 1;
      return { ok: true, status: hit.status, data: hit.data, cached: true };
    }
    if (hit) cache.delete(cacheKey);
  }
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const run = execute(path, params, options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES, ttl, cacheKey).finally(() => {
    inflight.delete(cacheKey);
  });
  inflight.set(cacheKey, run);
  return run;
}

// --- Bağlantı yoklaması (admin) -----------------------------------------------------------------------------------------

export type EmlakFiyatiProbeState = "connected" | "auth" | "forbidden" | "rate_limited" | "network" | "server" | "disabled";

/**
 * Salt-okunur doğrulama: GET /api/endeks?path=istanbul&tip=konut (doğrulanmış istek). Tek deneme; yeniden deneme, önbellek,
 * eski anahtar ve alarm YOK. Anahtar sonuca yazılmaz. Başarıda yalnız "son başarılı çağrı" damgası güncellenir.
 */
export async function probeEmlakFiyatiConnection(): Promise<{ state: EmlakFiyatiProbeState }> {
  if (!ALLOWED_ORIGIN) return { state: "disabled" };
  invalidateEmlakFiyatiKeyCache();
  const keys = await resolveEmlakFiyatiKeys();
  if (!keys.current) return { state: "disabled" };
  const params = validateQuery({ path: "istanbul", tip: "konut" });
  const url = new URL("/api/endeks", EMLAKFIYATI_BASE_URL);
  url.search = params.toString();
  const out = await singleAttempt(url.toString(), keys.current, "/api/endeks", 64 * 1024, false);
  if (out.ok) {
    void recordLastSuccess(true);
    return { state: "connected" };
  }
  switch (out.kind) {
    case "auth":
    case "forbidden":
    case "rate_limited":
    case "server":
      return { state: out.kind };
    default:
      return { state: "network" };
  }
}

// ===========================================================================================================================
// ORTAK API v1 AKTARIMI (docs/integrations/EMLAKFIYATI_ORTAK_API_V1.md) — emlakfiyati.com'a giden ortak/referans çağrıları da
// YALNIZ bu dosyadan çıkar. Kapı (bayrak + yoklama) ve kontör mantığı BURADA DEĞİL (ortak.ts / ef-credits/service.ts).
// ===========================================================================================================================

type Lane = "value" | "pdf" | "other";

function makeLimiter(max: number) {
  let running = 0;
  let peak = 0;
  const queue: Array<() => void> = [];
  return {
    async acquire(): Promise<void> {
      if (running < max) {
        running += 1;
        peak = Math.max(peak, running);
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
    },
    release(): void {
      const next = queue.shift();
      if (next) next();
      else running -= 1;
    },
    peak: () => peak,
    reset(): void {
      running = 0;
      peak = 0;
      queue.length = 0;
    },
  };
}

const lanes: Record<Lane, ReturnType<typeof makeLimiter>> = {
  value: makeLimiter(EMLAKFIYATI_ORTAK_MAX_VALUATION_CONCURRENCY),
  pdf: makeLimiter(EMLAKFIYATI_ORTAK_MAX_PDF_CONCURRENCY),
  other: makeLimiter(EMLAKFIYATI_MAX_CONCURRENCY),
};
/** Kullanıcı başına eşzamanlı çağrı üst sınırı (değerleme 2, PDF 1); yalnız o örnek (instance) içinde geçerli. */
const USER_LANE_MAX: Record<Lane, number> = { value: 2, pdf: 1, other: 4 };
const userInflight = new Map<string, number>();
const referenceCache = new Map<string, { expires: number; data: unknown }>();
const referenceInflight = new Map<string, Promise<OrtakRaw>>();
const REFERENCE_TTL_MS = 6 * 60 * 60 * 1000;
const REFERENCE_CACHE_MAX = 400;

export function getOrtakPeakConcurrency(): Record<Lane, number> {
  return { value: lanes.value.peak(), pdf: lanes.pdf.peak(), other: lanes.other.peak() };
}

function resetOrtakStateForTests(): void {
  for (const l of Object.values(lanes)) l.reset();
  userInflight.clear();
  referenceCache.clear();
  referenceInflight.clear();
}

export type OrtakCallSpec = {
  method: "GET" | "POST";
  path: string;
  query?: URLSearchParams;
  body?: string;
  userRef?: string;
  /** POST /degerleme: yeniden denemelerde AYNI değer kullanılır (bu işlev değiştirmez). */
  idempotencyKey?: string;
  lane: Lane;
  expect: "json" | "pdf";
  /** false: tek deneme (yoklama). */
  retries?: boolean;
  /** Yoklama: 401 alarmı/blok/eski anahtar YOK ve anahtar önbelleği tazelenir. */
  probe?: boolean;
  timeoutMs?: number;
  /** Bekleme dahil toplam süre bütçesi (ms); aşılacaksa yeniden denenmez. */
  deadlineMs?: number;
};

export type OrtakRaw =
  | {
      ok: true;
      status: number;
      requestId: string | null;
      replayed: boolean;
      attempts: number;
      json?: unknown;
      bytes?: Uint8Array;
    }
  | {
      ok: false;
      kind: OrtakErrorKind;
      status?: number;
      /** Güvenli makine kodu (kapsam_yok, ortak_bagi_yok, rapor_yok...). Hata METNİ taşınmaz. */
      code: string | null;
      requestId: string | null;
      retryAfterSec: number | null;
      attempts: number;
    };

type OneShot =
  | { ok: true; status: number; requestId: string | null; replayed: boolean; json?: unknown; bytes?: Uint8Array }
  | { ok: false; kind: OrtakErrorKind; status?: number; code: string | null; requestId: string | null; retryAfterSec: number | null };

async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = res.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await discardExternalResponse(res);
    return null;
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

async function oneShot(spec: OrtakCallSpec, apiKey: string | null): Promise<OneShot> {
  const headers = apiKey
    ? buildEmlakFiyatiHeaders(
        apiKey,
        { userRef: spec.userRef, idempotencyKey: spec.idempotencyKey },
        { accept: spec.expect === "pdf" ? "application/pdf" : "application/json", jsonBody: spec.body !== undefined },
      )
    : buildEmlakFiyatiPublicHeaders();
  const url = new URL(spec.path, EMLAKFIYATI_BASE_URL);
  url.search = spec.query?.toString() ?? "";
  assertAllowedOutbound(url.toString(), headers); // fırlatırsa ağa ÇIKILMAZ
  const lane = lanes[spec.lane];
  await lane.acquire();
  try {
    const res = await fetchExternal(
      url.toString(),
      { method: spec.method, headers, body: spec.body, cache: "no-store" },
      { timeoutMs: spec.timeoutMs ?? EMLAKFIYATI_ORTAK_TIMEOUT_MS },
    );
    const requestId = sanitizeRequestId(res.headers.get("x-istek-id"));
    const replayed = res.headers.get("idempotency-replayed")?.toLowerCase() === "true";
    if (res.status >= 200 && res.status < 300) {
      if (spec.expect === "json") {
        try {
          const json = await readExternalJson<unknown>(res, EMLAKFIYATI_ORTAK_JSON_MAX_BYTES);
          return { ok: true, status: res.status, requestId, replayed, json };
        } catch (error) {
          console.error("EmlakFiyati ortak yanıtı okunamadı", externalErrorMetadata(error));
          return { ok: false, kind: "invalid_response", status: res.status, code: null, requestId, retryAfterSec: null };
        }
      }
      const type = res.headers.get("content-type") ?? "";
      const bytes = type.toLowerCase().includes("application/pdf") ? await readBytesCapped(res, EMLAKFIYATI_ORTAK_PDF_MAX_BYTES) : null;
      if (!bytes || bytes.byteLength < PDF_MAGIC.length || !PDF_MAGIC.every((b, i) => bytes[i] === b)) {
        if (!bytes) await discardExternalResponse(res);
        return { ok: false, kind: "invalid_response", status: res.status, code: null, requestId, retryAfterSec: null };
      }
      return { ok: true, status: res.status, requestId, replayed, bytes };
    }
    let code: string | null = null;
    try {
      code = extractOrtakErrorCode(await readExternalJson<unknown>(res, 8 * 1024));
    } catch {
      await discardExternalResponse(res);
    }
    return {
      ok: false,
      kind: classifyOrtakStatus(res.status, code),
      status: res.status,
      code,
      requestId,
      retryAfterSec: parseRetryAfterSeconds(res.headers.get("retry-after")),
    };
  } catch (error) {
    const meta = externalErrorMetadata(error);
    console.error("EmlakFiyati ortak isteği başarısız", meta);
    return { ok: false, kind: meta.kind === "timeout" ? "timeout" : "network", code: null, requestId: null, retryAfterSec: null };
  } finally {
    lane.release();
  }
}

/** Tek anahtarla, sözleşmedeki geri çekilme kurallarıyla (AYNI Idempotency-Key) deneme döngüsü. */
async function ortakLoop(spec: OrtakCallSpec, apiKey: string | null): Promise<OrtakRaw> {
  const startedAt = now();
  const budget = spec.deadlineMs ?? 240_000;
  const counts = new Map<OrtakErrorKind, number>();
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const r = await oneShot(spec, apiKey);
    if (r.ok) return { ...r, attempts };
    if (spec.retries === false) return { ...r, attempts };
    const retryIndex = counts.get(r.kind) ?? 0;
    const delay = ortakRetryDelayMs({ kind: r.kind, retryIndex, retryAfterSec: r.retryAfterSec, random: randomImpl });
    if (delay === null || now() - startedAt + delay > budget) return { ...r, attempts };
    counts.set(r.kind, retryIndex + 1);
    await sleepImpl(delay);
  }
}

function disabledRaw(): OrtakRaw {
  return { ok: false, kind: "disabled", code: null, requestId: null, retryAfterSec: null, attempts: 0 };
}

/**
 * Anahtarlı ortak çağrı. Yol YALNIZ ortak beyaz listeden. Hata olsa FIRLATMAZ. Anahtar çözümleme/rotasyon/401 alarmı
 * mevcut mekanizmayla (keys.ts + raiseAuthAlarm); 401'de YENİDEN DENEME YOK (yalnız geçerli `previous` ile BİR kez).
 * Kapı (bayrak/yoklama) çağıranın işidir (ortak-client.ts); yoklama bu işlevi kapısız çağırır.
 */
export async function ortakCall(spec: OrtakCallSpec): Promise<OrtakRaw> {
  try {
    return await ortakCallInner(spec);
  } catch (error) {
    if (error instanceof EmlakFiyatiPolicyError) return disabledRaw(); // politika ihlali: ağa çıkılmadı
    throw error;
  }
}

async function ortakCallInner(spec: OrtakCallSpec): Promise<OrtakRaw> {
  if (!ALLOWED_ORIGIN || !isAllowedOrtakPath(spec.path)) return disabledRaw();
  if (spec.probe) invalidateEmlakFiyatiKeyCache();
  const keys = await resolveEmlakFiyatiKeys();
  if (!keys.current) return disabledRaw();
  if (!spec.probe && (authBlockedUntil.get(keys.fingerprint) ?? 0) > now()) {
    return { ok: false, kind: "auth", status: 401, code: null, requestId: null, retryAfterSec: null, attempts: 0 };
  }

  const userKey = spec.userRef ? `${spec.lane}:${spec.userRef}` : null;
  if (userKey) {
    const inUse = userInflight.get(userKey) ?? 0;
    if (inUse >= USER_LANE_MAX[spec.lane]) {
      return { ok: false, kind: "too_many_local", code: null, requestId: null, retryAfterSec: null, attempts: 0 };
    }
    userInflight.set(userKey, inUse + 1);
  }
  try {
    const usePreviousFirst = !spec.probe && Boolean(keys.previous) && preferPrevious.has(keys.fingerprint);
    const first = usePreviousFirst ? (keys.previous as string) : keys.current;
    let out = await ortakLoop(spec, first);
    if (!out.ok && out.kind === "auth" && !usePreviousFirst && !spec.probe && keys.previous) {
      const viaPrevious = await ortakLoop({ ...spec, retries: false }, keys.previous);
      if (viaPrevious.ok) {
        preferPrevious.add(keys.fingerprint);
        void noticePreviousKeyUsed();
      }
      out = viaPrevious;
    }
    if (out.ok) {
      if (!spec.probe) void recordLastSuccess();
      return out;
    }
    if (out.kind === "auth" && !spec.probe) {
      authBlockedUntil.set(keys.fingerprint, now() + AUTH_BLOCK_MS);
      await raiseAuthAlarm();
    }
    return out;
  } finally {
    if (userKey) {
      const left = (userInflight.get(userKey) ?? 1) - 1;
      if (left <= 0) userInflight.delete(userKey);
      else userInflight.set(userKey, left);
    }
  }
}

/**
 * Anahtarsız mahalle referans uçları (yalnız /api/musteri/iller|ilceler|mahalleler): 6 saat bellek önbelleği + eşzamanlı birleştirme.
 * Sözleşmenin parçası DEĞİL ve sınırsız kullanım garantisi yok; her tıklamada çağrılmaz.
 */
export async function ortakReferenceGet(path: string, query: URLSearchParams): Promise<OrtakRaw> {
  if (!ALLOWED_ORIGIN || !isAllowedReferencePath(path)) return disabledRaw();
  const cacheKey = `${path}?${query.toString()}`;
  const hit = referenceCache.get(cacheKey);
  if (hit && hit.expires > now()) return { ok: true, status: 200, requestId: null, replayed: false, attempts: 0, json: hit.data };
  if (hit) referenceCache.delete(cacheKey);
  const pending = referenceInflight.get(cacheKey);
  if (pending) return pending;
  const run = ortakLoop(
    { method: "GET", path, query, lane: "other", expect: "json", timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS, deadlineMs: 45_000 },
    null,
  )
    .then((out) => {
      if (out.ok) {
        if (referenceCache.size >= REFERENCE_CACHE_MAX) {
          const oldest = referenceCache.keys().next().value;
          if (oldest !== undefined) referenceCache.delete(oldest);
        }
        referenceCache.set(cacheKey, { expires: now() + REFERENCE_TTL_MS, data: out.json });
      }
      return out;
    })
    .finally(() => {
      referenceInflight.delete(cacheKey);
    });
  referenceInflight.set(cacheKey, run);
  return run;
}
