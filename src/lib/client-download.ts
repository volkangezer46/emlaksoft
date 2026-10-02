const QR_ORIGIN = "https://api.qrserver.com";
const QR_PATH = "/v1/create-qr-code/";
const MAX_QR_BYTES = 2 * 1024 * 1024;

export async function fetchTrustedQrPng(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  const url = new URL(rawUrl);
  if (
    url.origin !== QR_ORIGIN ||
    url.pathname !== QR_PATH ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Güvenilmeyen QR adresi.");
  }

  const response = await fetchImpl(url, {
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`QR servisi HTTP ${response.status}.`);

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "image/png") throw new Error("QR servisi PNG döndürmedi.");

  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_QR_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("QR görseli boyut sınırını aştı.");
  }

  const blob = await response.blob();
  if (blob.size > MAX_QR_BYTES) throw new Error("QR görseli boyut sınırını aştı.");
  return blob;
}

const INTERNAL_API_ORIGIN = "https://internal.emlaksoft.invalid";

/** Normalize generic client hooks to same-origin `/api` routes only. */
export function normalizeInternalApiUrl(rawUrl: string): string {
  const url = new URL(rawUrl, INTERNAL_API_ORIGIN);
  if (
    url.origin !== INTERNAL_API_ORIGIN ||
    (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Yalnız aynı origin /api adresleri kullanılabilir.");
  }
  return `${url.pathname}${url.search}`;
}
