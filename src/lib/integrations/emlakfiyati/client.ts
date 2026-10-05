import "server-only";

import { unstable_cache } from "next/cache";
import { now } from "@/lib/clock";
import {
  discardExternalResponse,
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";
import { normalizeProviderBaseUrl, PROVIDER_REQUEST_TIMEOUT_MS } from "@/lib/integrations/provider-url";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import {
  buildEndeksPath,
  buildEndeksUrl,
  EMLAKFIYATI_HOST,
  endeksRequestSchema,
  parentPath,
  parseEndeksResponse,
  summarizeEndeks,
  type EmlakFiyatiTip,
  type EndeksRow,
  type EndeksSummary,
} from "./contract";

/**
 * EmlakFiyati sunucu istemcisi (https://emlakfiyati.com/api/endeks).
 *
 * - Anahtar yalnız ortam değişkeni EMLAKFIYATI_API_KEY (sunucu; NEXT_PUBLIC_ DEĞİL). Yoksa özellik "etkin değil"
 *   döner ve hiçbir sayfa kırılmaz.
 * - Dış çağrı yalnız `fetchExternal` sınırından geçer: HTTPS + tek host (emlakfiyati.com), zaman aşımı, yönlendirme
 *   reddi, yanıt boyut sınırı. İsteğe yalnız coğrafi yol ve tip girer (kişisel veri yok).
 * - Önbellek: başarılı/boş sonuç 12 saat (seri aylıktır) `unstable_cache` + etiket; hata/401/429 sonuçları kısa süre
 *   bellekte tutulur (negatif önbellek) ve 429 `Retry-After`'a saygı gösterir.
 */

export const EMLAKFIYATI_CACHE_TAG = "emlakfiyati-endeks";
const SUCCESS_TTL_SECONDS = 12 * 60 * 60;
const ERROR_TTL_MS = 5 * 60 * 1000;
const AUTH_ERROR_TTL_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60 * 1000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const LAST_OK_SETTING_KEY = "emlakfiyati_last_ok_at";
const LAST_OK_WRITE_INTERVAL_MS = 10 * 60 * 1000;

/** Tek izinli kök (https + emlakfiyati.com); başka host/şema fail-closed. */
const ALLOWED_ORIGIN = normalizeProviderBaseUrl(`https://${EMLAKFIYATI_HOST}`, [EMLAKFIYATI_HOST]);

export function getEmlakFiyatiApiKey(): string | null {
  const key = process.env.EMLAKFIYATI_API_KEY?.trim();
  return key ? key : null;
}

/** Anahtar tanımlı mı (değeri ASLA dışarı vermez). */
export function isEmlakFiyatiConfigured(): boolean {
  return getEmlakFiyatiApiKey() != null && ALLOWED_ORIGIN != null;
}

// --- Negatif önbellek / hız sınırı (örnek-içi, bilinçli kısa ömürlü) -------------------------------------------------

const failureUntil = new Map<string, number>();
let globalBackoffUntil = 0;

function negativeKey(path: string, tip: string): string {
  return `${path}|${tip}`;
}

/** Test yardımcısı: bellek içi durumu sıfırlar. */
export function resetEmlakFiyatiStateForTests(): void {
  failureUntil.clear();
  globalBackoffUntil = 0;
  lastOkWrittenAt = 0;
}

class EmlakFiyatiRequestError extends Error {
  constructor(
    readonly kind: "auth" | "rate_limited" | "failed",
    readonly retryAfterMs?: number,
  ) {
    super("EmlakFiyati isteği başarısız.");
    this.name = "EmlakFiyatiRequestError";
  }
}

function parseRetryAfterMs(header: string | null): number {
  if (header && /^\d{1,6}$/.test(header.trim())) {
    return Math.min(Number(header.trim()) * 1000, MAX_BACKOFF_MS);
  }
  return DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

// --- Son başarılı çağrı (opsiyonel; platform_settings, migration yok) -----------------------------------------------

let lastOkWrittenAt = 0;

async function recordLastSuccess(): Promise<void> {
  const t = now();
  if (t - lastOkWrittenAt < LAST_OK_WRITE_INTERVAL_MS) return;
  lastOkWrittenAt = t;
  try {
    await setPlatformSetting(LAST_OK_SETTING_KEY, new Date(t).toISOString());
  } catch {
    // Gözlem amaçlı; hata değerlemeyi/sayfayı etkilemez.
  }
}

/** Platform ekranı için son başarılı API çağrısının ISO zamanı (yoksa null). */
export async function getEmlakFiyatiLastSuccessAt(): Promise<string | null> {
  const value = await getPlatformSetting(LAST_OK_SETTING_KEY);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

// --- Ağ çağrısı ---------------------------------------------------------------------------------------------------

async function fetchEndeksRows(path: string, tip: EmlakFiyatiTip): Promise<EndeksRow[]> {
  const key = getEmlakFiyatiApiKey();
  if (!key || !ALLOWED_ORIGIN) throw new EmlakFiyatiRequestError("auth");
  const url = buildEndeksUrl({ path, tip });
  if (new URL(url).origin !== ALLOWED_ORIGIN) throw new EmlakFiyatiRequestError("failed");

  try {
    const res = await fetchExternal(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Cache-Control": "no-store" },
        cache: "no-store",
      },
      { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS },
    );
    if (res.status === 404) {
      await discardExternalResponse(res);
      return [];
    }
    if (res.status === 429) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      await discardExternalResponse(res);
      throw new EmlakFiyatiRequestError("rate_limited", retryAfterMs);
    }
    if (res.status === 401 || res.status === 403) {
      await discardExternalResponse(res);
      throw new EmlakFiyatiRequestError("auth");
    }
    await requireExternalSuccess(res);
    const parsed = parseEndeksResponse(await readExternalJson<unknown>(res, MAX_RESPONSE_BYTES));
    if (!parsed.ok) throw new SyntaxError("EmlakFiyati yanıt biçimi geçersiz.");
    await recordLastSuccess();
    return parsed.rows;
  } catch (error) {
    if (error instanceof EmlakFiyatiRequestError) throw error;
    console.error("EmlakFiyati endeks isteği başarısız", externalErrorMetadata(error));
    throw new EmlakFiyatiRequestError("failed");
  }
}

/** Başarılı/boş sonuçlar 12 saat önbelleklenir; hata atan çağrı önbelleğe YAZILMAZ. */
const cachedEndeksRows = unstable_cache(
  async (path: string, tip: EmlakFiyatiTip): Promise<EndeksRow[]> => fetchEndeksRows(path, tip),
  ["emlakfiyati-endeks-v1"],
  { revalidate: SUCCESS_TTL_SECONDS, tags: [EMLAKFIYATI_CACHE_TAG] },
);

export type EndeksResult =
  | { status: "ok"; summary: EndeksSummary }
  | { status: "empty" }
  | { status: "disabled" }
  | { status: "error" };

/** Tek yol + tip için endeks. Anahtar yoksa "disabled"; hata olsa da ASLA fırlatmaz. */
export async function getEndeks(input: { path: string; tip: EmlakFiyatiTip }): Promise<EndeksResult> {
  if (!isEmlakFiyatiConfigured()) return { status: "disabled" };
  const request = endeksRequestSchema.safeParse(input);
  if (!request.success) return { status: "empty" };
  const { path, tip } = request.data;

  const t = now();
  if (t < globalBackoffUntil) return { status: "error" };
  const blockedUntil = failureUntil.get(negativeKey(path, tip));
  if (blockedUntil && t < blockedUntil) return { status: "error" };

  try {
    const rows = await cachedEndeksRows(path, tip);
    const summary = summarizeEndeks(rows, tip);
    return summary ? { status: "ok", summary } : { status: "empty" };
  } catch (error) {
    const failure = error instanceof EmlakFiyatiRequestError ? error : null;
    const until = now();
    if (failure?.kind === "rate_limited") {
      globalBackoffUntil = until + (failure.retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS);
    } else {
      failureUntil.set(negativeKey(path, tip), until + (failure?.kind === "auth" ? AUTH_ERROR_TTL_MS : ERROR_TTL_MS));
    }
    return { status: "error" };
  }
}

export type EndeksLookup = EndeksResult & { requestedPath: string | null };

/**
 * İl/ilçe/mahalle adlarından en özel yoldan başlayıp veri bulunana dek üst seviyeye iner
 * (mahalle -> ilçe -> il). Dönen özetin `level`/`ad` alanı hangi seviyenin kullanıldığını söyler.
 * Sonuç "error" ise üst seviyeye İNİLMEZ (hata gerçek boşluk değildir).
 */
export async function getEndeksForPlace(input: {
  province?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  tip: EmlakFiyatiTip;
}): Promise<EndeksLookup> {
  const requestedPath = buildEndeksPath(input);
  if (!requestedPath) return { status: "empty", requestedPath: null };
  let path: string | null = requestedPath;
  let last: EndeksResult = { status: "empty" };
  while (path) {
    last = await getEndeks({ path, tip: input.tip });
    if (last.status !== "empty") break;
    path = parentPath(path);
  }
  return { ...last, requestedPath };
}
