import {
  ExternalHttpError,
  discardExternalResponse,
  externalErrorMetadata,
  fetchExternal,
  readExternalJson,
  requireExternalSuccess,
} from "@/lib/external-fetch";

/**
 * PageSpeed Insights v5 (laboratuvar: Lighthouse) istemcisi. Dış çağrı YALNIZ `www.googleapis.com` adresine,
 * `fetchExternal` ile (yönlendirme reddi + süre sınırı) yapılır. Anahtar yoksa anahtarsız (düşük kota) denenir;
 * 429 dürüst "kota doldu" durumuna çevrilir. Yalnız kayıt defterindeki herkese açık yollar ölçülür (çağıran denetler).
 */
export const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export type PsiDevice = "mobile" | "desktop";
export const PSI_DEVICES: readonly PsiDevice[] = ["mobile", "desktop"];

export type LabMetrics = {
  score: number | null;
  lcp_ms: number | null;
  inp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  ttfb_ms: number | null;
  bytes: number | null;
  requests: number | null;
  html_gz: number | null;
};

export type PsiOutcome =
  | { status: "ok"; metrics: LabMetrics }
  | { status: "quota"; message: string }
  | { status: "error"; message: string };

export function buildPsiUrl(pageUrl: string, device: PsiDevice, key?: string | null): string {
  const u = new URL(PSI_ENDPOINT);
  u.searchParams.set("url", pageUrl);
  u.searchParams.set("strategy", device);
  u.searchParams.set("category", "performance");
  u.searchParams.set("locale", "tr");
  if (key) u.searchParams.set("key", key);
  return u.toString();
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

type Audit = { numericValue?: unknown; details?: { items?: unknown[] } };

/** PSI yanıtı → metrikler (SAF; eksik alan null). */
export function parsePsiResult(json: unknown): LabMetrics {
  const root = (json ?? {}) as {
    lighthouseResult?: { categories?: { performance?: { score?: unknown } }; audits?: Record<string, Audit> };
    loadingExperience?: { metrics?: Record<string, { percentile?: unknown }> };
  };
  const lh = root.lighthouseResult ?? {};
  const audits = lh.audits ?? {};
  const a = (k: string) => num(audits[k]?.numericValue);
  const score = num(lh.categories?.performance?.score);
  const items = audits["network-requests"]?.details?.items;
  const list = Array.isArray(items) ? (items as Array<{ resourceType?: unknown; transferSize?: unknown }>) : null;
  const doc = list?.find((i) => i.resourceType === "Document");
  // INP laboratuvarda ölçülmez: varsa saha (CrUX) p75 değeri, yoksa null.
  const inpField = num(root.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile);
  return {
    score: score === null ? null : Math.round(score * 100),
    lcp_ms: a("largest-contentful-paint"),
    inp_ms: inpField,
    cls: a("cumulative-layout-shift"),
    tbt_ms: a("total-blocking-time"),
    ttfb_ms: a("server-response-time"),
    bytes: a("total-byte-weight"),
    requests: list ? list.length : null,
    html_gz: doc ? num(doc.transferSize) : null,
  };
}

export type StaticModeTag = "statik" | "yedek" | "normal";

/** Rota modu + son çizim → koşu etiketi (ölçüm hangi sürüme yapıldı). */
export function staticModeTag(mode: string | null, lastStatic: boolean | null): StaticModeTag {
  if (mode !== "on") return "normal";
  return lastStatic === false ? "yedek" : "statik";
}

/** Tek PSI koşusu (hata fırlatmaz). */
export async function runPsi(
  pageUrl: string,
  device: PsiDevice,
  key: string | null,
  fetchImpl: typeof fetchExternal = fetchExternal,
): Promise<PsiOutcome> {
  const url = buildPsiUrl(pageUrl, device, key);
  if (new URL(url).hostname !== "www.googleapis.com") return { status: "error", message: "geçersiz PSI adresi" };
  try {
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, cache: "no-store" }, { timeoutMs: 90_000 });
    if (res.status === 429) {
      await discardExternalResponse(res);
      return {
        status: "quota",
        message: key ? "PageSpeed kotası doldu; biraz sonra yeniden deneyin." : "Anahtarsız PageSpeed kotası doldu; Laboratuvar ekranından API anahtarı ekleyin.",
      };
    }
    await requireExternalSuccess(res);
    return { status: "ok", metrics: parsePsiResult(await readExternalJson<unknown>(res, 16 * 1024 * 1024)) };
  } catch (e) {
    const meta = externalErrorMetadata(e);
    if (e instanceof ExternalHttpError && (e.status === 400 || e.status === 403)) {
      return { status: "error", message: `PageSpeed isteği reddedildi (HTTP ${e.status}); anahtarı ve adresi kontrol edin.` };
    }
    return { status: "error", message: meta.kind === "timeout" ? "PageSpeed zaman aşımı (90 sn)" : `PageSpeed hatası (${meta.kind}${meta.status ? ` ${meta.status}` : ""})` };
  }
}
