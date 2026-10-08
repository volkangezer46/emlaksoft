/**
 * KÖPRÜ SÖZLEŞMESİ (istemci). Portal sayfasını kullanıcının KENDİ tarayıcı oturumunda okuyabilen tek şey, kullanıcının
 * kurduğu tarayıcı eklentisidir (içerik betiği emlaksoft sayfasıyla `window.postMessage` ile konuşur). Eklenti:
 * `extensions/emlaksoft-ilan-kontrol/` (Manifest V3; `npm run build:extension`). Sözleşme burada sabittir; eklenti bu
 * dosyayı DOĞRUDAN derler (kopya yok):
 *
 *   sayfa → eklenti : { source: "emlaksoft-listing-control", type: "verify-request", id, portal, url, externalId }
 *   eklenti → sayfa : { source: "emlaksoft-listing-control-bridge", type: "verify-response", id, reply: ProbeReply }
 *   eklenti → sayfa : { source: "emlaksoft-listing-control-bridge", type: "ready", version }   (kurulu ve hazır)
 *   (ek, geriye uyumlu) mağaza/liste sayfası okuma:
 *   sayfa → eklenti : { source: "emlaksoft-listing-control", type: "inventory-request", id, portal, url }
 *   eklenti → sayfa : { source: "emlaksoft-listing-control-bridge", type: "inventory-response", id, reply: { items, nextUrl, error } }
 *
 * (v2, tek tuş) Bağlantı ve durum:
 *   sayfa → eklenti : { source, type: "connect-request", nonce }   (YALNIZ kullanıcı tıklamasıyla; eklenti köken + kullanıcı etkinliği doğrular)
 *   eklenti → sayfa : { source: BRIDGE, type: "connect-response", nonce, ok }
 *   sayfa → eklenti : { source, type: "status-request", id }
 *   eklenti → sayfa : { source: BRIDGE, type: "status-response", id, status: ExtensionStatusView }
 *
 * Belge kökü işaretleri: `data-emlaksoft-listing-bridge="1"` (kurulu), `data-emlaksoft-listing-autorun="1"` (eklenti
 * otomatik kontrol döngüsünü KENDİSİ yürütüyor: sayfa içi işçi iş talep etmez, çift kontrol olmaz),
 * `data-emlaksoft-listing-paused="1"` (kullanıcı eklentiyi duraklattı: hiçbir kontrol yapılmaz),
 * `data-emlaksoft-listing-connected="1"` (kullanıcı "Bağlan" dedi ve bağlantı geçerli; yoksa eklenti HİÇ kontrol yapmaz),
 * `data-emlaksoft-listing-version` (kurulu eklenti sürümü).
 *
 * Köprü yoksa işçi HİÇ iş talep etmez (hiçbir ilan "doğrulanmış" ya da "yok" sayılmaz). Eklenti CAPTCHA/giriş duvarı
 * gördüğünde `error: "captcha" | "login_required"`, hız sınırında `http_429` döner; işçi bunları aşmaya çalışmaz.
 * Eklenti kendi hız kuralı yüzünden isteği o an yapamazsa `error: "busy"`, duraklatılmışsa `error: "paused"` döner:
 * işçi bu işi gözlem YAZMADAN bırakır. Mesajlar yalnız aynı pencere/aynı kökenden kabul edilir.
 */

export const BRIDGE_REQUEST_SOURCE = "emlaksoft-listing-control";
export const BRIDGE_RESPONSE_SOURCE = "emlaksoft-listing-control-bridge";

export type BridgeJob = { id: string; portal: string; url: string; externalId: string | null };
export type InventoryJob = { id: string; portal: string; url: string };

export type BridgeMessage =
  | { type: "ready"; version: string }
  | { type: "verify-response"; id: string; reply: unknown }
  | { type: "inventory-response"; id: string; reply: unknown }
  | { type: "connect-response"; nonce: string; ok: boolean }
  | { type: "status-response"; id: string; status: unknown };

/** Eklentinin "şimdi yapamadım / duraklatıldı" yanıtları: gözlem değildir, iş bırakılır. */
export const BRIDGE_DEFER_ERRORS: readonly string[] = ["busy", "paused", "not_connected", "portal_disabled"];

/** Gelen mesaj verisini doğrular (SAF; testli). Geçersizse null. */
export function parseBridgeMessage(data: unknown): BridgeMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.source !== BRIDGE_RESPONSE_SOURCE) return null;
  if (d.type === "ready") return { type: "ready", version: typeof d.version === "string" ? d.version.slice(0, 20) : "0" };
  if ((d.type === "verify-response" || d.type === "inventory-response") && typeof d.id === "string" && d.id.length > 0 && d.id.length <= 64) {
    return { type: d.type, id: d.id, reply: d.reply };
  }
  if (d.type === "connect-response" && typeof d.nonce === "string" && d.nonce.length > 0 && d.nonce.length <= 64) {
    return { type: "connect-response", nonce: d.nonce, ok: d.ok === true };
  }
  if (d.type === "status-response" && typeof d.id === "string" && d.id.length > 0 && d.id.length <= 64) {
    return { type: "status-response", id: d.id, status: d.status };
  }
  return null;
}

/** Köprü hazır mı? Eklenti belge köküne işaret koyar (sayfa açıldıktan sonra gelen `ready` iletisi de kabul edilir). */
export function bridgeInstalled(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.emlaksoftListingBridge === "1";
}

/** Eklenti otomatik kontrolü kendisi yürütüyor mu (sayfa içi işçi o zaman iş talep etmez). */
export function bridgeAutorun(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.emlaksoftListingAutorun === "1";
}

/** Kullanıcı eklentiyi bağladı mı (bağlı değilse eklenti hiçbir kontrol yapmaz). */
export function bridgeConnected(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.emlaksoftListingConnected === "1";
}

/** Belge köküne yazılan kurulu eklenti sürümü (yoksa null). */
export function bridgeVersion(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.dataset.emlaksoftListingVersion ?? null;
}

/** Kullanıcı eklentiyi duraklattı mı. */
export function bridgePaused(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.emlaksoftListingPaused === "1";
}

/** Mağaza/liste sayfası okuma isteği (sayfa başına). Eklenti hız kuralı nedeniyle 20-30 sn bekleyebilir. */
export function requestInventoryPage(job: InventoryJob, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reply: unknown) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(reply);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const msg = parseBridgeMessage(event.data);
      if (msg?.type === "inventory-response" && msg.id === job.id) finish(msg.reply);
    };
    const timer = window.setTimeout(() => finish({ items: [], nextUrl: null, error: "timeout" }), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: BRIDGE_REQUEST_SOURCE, type: "inventory-request", id: job.id, portal: job.portal, url: job.url }, window.location.origin);
  });
}

/** Tek iş için köprüye istek yollar; zaman aşımında `{ error: "timeout" }` (ASLA "yok" değil). */
export function requestProbe(job: BridgeJob, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reply: unknown) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(reply);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const msg = parseBridgeMessage(event.data);
      if (msg?.type === "verify-response" && msg.id === job.id) finish(msg.reply);
    };
    const timer = window.setTimeout(() => finish({ error: "timeout" }), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: BRIDGE_REQUEST_SOURCE, type: "verify-request", id: job.id, portal: job.portal, url: job.url, externalId: job.externalId },
      window.location.origin,
    );
  });
}

function postAndWait(message: Record<string, unknown>, match: (m: BridgeMessage) => boolean, timeoutMs: number): Promise<BridgeMessage | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (m: BridgeMessage | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(m);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const msg = parseBridgeMessage(event.data);
      if (msg && match(msg)) finish(msg);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: BRIDGE_REQUEST_SOURCE, ...message }, window.location.origin);
  });
}

/** Eklentiye "bağlan" der. YALNIZ bir tıklama olay işleyicisinden çağrılmalı: eklenti kullanıcı etkinliği arar. */
export async function requestConnect(timeoutMs = 4_000): Promise<boolean> {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const msg = await postAndWait({ type: "connect-request", nonce }, (m) => m.type === "connect-response" && m.nonce === nonce, timeoutMs);
  return msg?.type === "connect-response" && msg.ok;
}

/** Eklentinin durum görünümünü ister (yanıt yoksa null). Doğrulama: `parseStatusView`. */
export async function requestStatus(timeoutMs = 2_500): Promise<unknown> {
  const id = `st-${Math.random().toString(36).slice(2, 10)}`;
  const msg = await postAndWait({ type: "status-request", id }, (m) => m.type === "status-response" && m.id === id, timeoutMs);
  return msg?.type === "status-response" ? msg.status : null;
}
