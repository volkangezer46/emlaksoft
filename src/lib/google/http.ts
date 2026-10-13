import {
  ExternalHttpError,
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";

/**
 * Google'a giden HER istek bu kapıdan geçer: yalnız HTTPS ve SABİT host listesi, yönlendirme reddi + süre sınırı
 * (`fetchExternal`), yanıt boyutu tavanı. Gövde/mesaj log'a yazılmaz; hata yalnız durum kodu ve Google hata kodu taşır.
 * Testler `fetcher` ile sahte istemci verir (gerçek ağ YOK).
 */

export const GOOGLE_ALLOWED_HOSTS = [
  "oauth2.googleapis.com",
  "accounts.google.com",
  "searchconsole.googleapis.com",
  "www.googleapis.com",
  "googleads.googleapis.com",
] as const;

export type GoogleFetcher = (url: string, init: RequestInit) => Promise<Response>;

export type GoogleDeps = {
  /** Test/sahte istemci. Verilmezse `fetchExternal` (yönlendirme reddi + süre sınırı). */
  fetcher?: GoogleFetcher;
  timeoutMs?: number;
};

export const GOOGLE_TIMEOUT_MS = 20_000;

/** Google API hatası: durum + (varsa) Google'ın makine kodu (`invalid_grant`, `PERMISSION_DENIED`...). Gövde YOK. */
export class GoogleApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(`Google API hatası (${status}${code ? `, ${code}` : ""})`);
    this.name = "GoogleApiError";
    this.status = status;
    this.code = code;
  }
}

export class GoogleHostError extends Error {
  constructor() {
    super("İzin verilmeyen Google adresi.");
    this.name = "GoogleHostError";
  }
}

/** İzin listesi denetimi: yalnız https + sabit host; port/kimlik bilgisi taşıyan adres reddedilir. */
export function assertGoogleUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GoogleHostError();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new GoogleHostError();
  if (!(GOOGLE_ALLOWED_HOSTS as readonly string[]).includes(url.hostname)) throw new GoogleHostError();
  return url;
}

export function isInvalidGrant(error: unknown): boolean {
  return error instanceof GoogleApiError && error.code === "invalid_grant";
}

/** Google hata gövdesinden YALNIZ makine kodunu çıkarır (OAuth: `error`; API: `error.status`). */
function errorCodeOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (typeof err === "string") return err.slice(0, 64);
  if (err && typeof err === "object") {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "string") return status.slice(0, 64);
  }
  return null;
}

/** Ham istek (izin listesi + kapı). Çağıran yanıtı okur. */
export async function googleFetch(url: string, init: RequestInit, deps: GoogleDeps = {}): Promise<Response> {
  const target = assertGoogleUrl(url).toString();
  if (deps.fetcher) return deps.fetcher(target, init);
  return fetchExternal(target, init, { timeoutMs: deps.timeoutMs ?? GOOGLE_TIMEOUT_MS });
}

/**
 * JSON isteği: 2xx değilse gövdeden yalnız hata kodu okunup `GoogleApiError` fırlatılır.
 * `maxBytes`: yanıt tavanı (Search Console 25.000 satırlık sayfa için büyük tutulur).
 */
export async function googleJson<T>(
  url: string,
  init: RequestInit,
  deps: GoogleDeps = {},
  maxBytes = 2 * 1024 * 1024,
): Promise<T> {
  const res = await googleFetch(url, init, deps);
  if (!res.ok) {
    let code: string | null = null;
    try {
      code = errorCodeOf(await readExternalJson<unknown>(res, 64 * 1024));
    } catch {
      code = null;
    }
    throw new GoogleApiError(res.status, code);
  }
  return readExternalJson<T>(res, maxBytes);
}

/** Gövdesi önemsiz istek (iptal vb.): yalnız başarı denetlenir. */
export async function googleExpectOk(url: string, init: RequestInit, deps: GoogleDeps = {}): Promise<void> {
  const res = await googleFetch(url, init, deps);
  try {
    await requireExternalSuccess(res);
  } catch (e) {
    if (e instanceof ExternalHttpError) throw new GoogleApiError(e.status, null);
    throw e;
  }
  try {
    await res.body?.cancel();
  } catch {
    /* gövde zaten kapalı */
  }
}
