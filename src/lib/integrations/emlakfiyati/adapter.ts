import "server-only";

import { now } from "@/lib/clock";
import {
  discardExternalResponse,
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
} from "@/lib/external-fetch";
import { normalizeProviderBaseUrl, PROVIDER_REQUEST_TIMEOUT_MS } from "@/lib/integrations/provider-url";
import { notifyPlatformStaff } from "@/lib/platform-notify";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { EF_SETTING, invalidateEmlakFiyatiKeyCache, resolveEmlakFiyatiKeys } from "./keys";
import {
  assertAllowedOutbound,
  backoffDelayMs,
  buildEmlakFiyatiHeaders,
  classifyStatus,
  cooldownMs,
  EMLAKFIYATI_BASE_URL,
  EMLAKFIYATI_MAX_CONCURRENCY,
  EmlakFiyatiPolicyError,
  isAllowedPath,
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
