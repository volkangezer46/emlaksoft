/**
 * Eklenti otomatik kontrol ucu (`/api/app/ilan-kontrol/isci`) için köken denetimi (SAF, testli). Kabul: özel başlık
 * `x-emlaksoft-bridge: 1` VE (Origin başlığı isteğin kendi host'u ya da `Sec-Fetch-Site: same-origin`). Özel başlık
 * başka bir kökenden CORS ön kontrolü olmadan gönderilemez; ucumuz CORS izni vermediği için siteler arası istek düşer.
 */
export const BRIDGE_HEADER = "x-emlaksoft-bridge";
export const BRIDGE_ENDPOINT = "/api/app/ilan-kontrol/isci";
/** Günlük mağaza taraması (ofisin kendi ilan listesi) yükleme ucu; aynı köken + aynı başlık kuralı. */
export const BRIDGE_INVENTORY_ENDPOINT = "/api/app/ilan-kontrol/envanter";

export function isSameOriginBridgeRequest(req: { headers: Headers; url: string }): boolean {
  if (req.headers.get(BRIDGE_HEADER) !== "1") return false;
  let host: string;
  try {
    host = new URL(req.url).host;
  } catch {
    return false;
  }
  const forwardedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? host;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin).host;
      return o === host || o === forwardedHost;
    } catch {
      return false;
    }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}
