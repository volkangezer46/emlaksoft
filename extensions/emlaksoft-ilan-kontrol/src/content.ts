import { BRIDGE_REQUEST_SOURCE, BRIDGE_RESPONSE_SOURCE } from "@/lib/listing-control/worker/bridge";
import { nextDelayMs, replyToReport, type StepOutcome } from "@/lib/listing-control/worker/core";
import {
  BRIDGE_ENDPOINT,
  BRIDGE_FEEDBACK_ENDPOINT,
  BRIDGE_FSBO_ENDPOINT,
  BRIDGE_HEADER,
  BRIDGE_IMPORT_ENDPOINT,
  BRIDGE_INVENTORY_ENDPOINT,
  BRIDGE_MEDIA_PATH,
  BRIDGE_RULES_ENDPOINT,
  BRIDGE_TRANSFER_DONE_ENDPOINT,
  BRIDGE_TRANSFER_FETCH_ENDPOINT,
  EXT_VERSION_HEADER,
} from "@/lib/listing-control/worker/bridge-request";
import { FORM_RULES_ENGINE } from "@/lib/portal-transfer/rule-format";
import { rulesRefreshDue, type RulesMeta } from "@/lib/portal-transfer/rules-store";
import type { FeedbackPayload } from "@/lib/portal-transfer/feedback-format";
import type { DonePayload, ImportPayload, QueueEntry } from "@/lib/portal-transfer/ext-queue";
import { buildTransferMark, sanitizeTransferWatermark, stampTransferMark, type TransferWatermark } from "@/lib/portal-transfer/photo-watermark";
import { PHOTO_JPEG_QUALITY, PHOTO_MAX_SIDE, bytesToBase64, photoBudget, photoSummary, scaledSize } from "@/lib/portal-transfer/photo-prep";
import type { FsboPending } from "@/lib/prospecting/extension-queue";
import type { ScanUpload } from "@/lib/listing-control/worker/extension-scan";
import { sendVerdict, type OutboxEntry } from "@/lib/listing-control/worker/extension-outbox";
import { isTrustedConnectRequest, isTrustedScanRequest, isTrustedTransferRequest } from "@/lib/listing-control/worker/extension-pairing";
import { buildTelemetry } from "@/lib/listing-control/worker/extension-telemetry";
import { STORAGE_KEYS, type BgRequest } from "./messages";

/**
 * İÇERİK BETİĞİ (yalnız EmlakSoft alanında çalışır; manifest `content_scripts.matches`). Üç iş:
 *  1) KÖPRÜ: belge köküne `data-emlaksoft-listing-bridge="1"` (+ sürüm, bağlı, duraklatıldı, otomatik) koyar, `ready` iletir ve
 *     sayfanın `verify-request` / `inventory-request` / `status-request` / `connect-request` iletilerini service worker'a taşır
 *     (sözleşme `src/lib/listing-control/worker/bridge.ts`). `connect-request` YALNIZ aynı pencere + aynı köken + izinli
 *     EmlakSoft kökeni + gerçek kullanıcı etkinliği (tıklama) ile kabul edilir.
 *  2) OTOMATİK KONTROL: kullanıcı BAĞLANDIYSA (popup "Bağlan" ya da sayfadaki "Eklentiyi bağla"), EmlakSoft'ta oturum açmışken
 *     ve eklenti duraklatılmamışken, açık sekmelerden YALNIZ BİRİ (lider kirası) sıradaki işi aynı kökendeki
 *     `/api/app/ilan-kontrol/isci` ucundan alır, service worker'a kontrol ettirir ve sonucu bildirir. Sekme kapanınca kira bırakılır.
 *  3) SONUÇ KUYRUĞU: sonuç gönderilemezse (çevrimdışı/5xx/oturum) service worker'ın kuyruğuna yazılır ve AYNI iş kimliğiyle
 *     yeniden denenir (sunucu idempotent); portal yeniden sorgulanmaz.
 */

declare const __EMLAKSOFT_APP_ORIGINS__: string[];

const root = document.documentElement;
const VERSION = chrome.runtime.getManifest().version;
const TAB_TOKEN = crypto.randomUUID();

function send<T>(msg: BgRequest): Promise<T | null> {
  try {
    return chrome.runtime.sendMessage<T>(msg).catch(() => null);
  } catch {
    // Eklenti yeniden yüklendi / bağlam geçersiz: sessizce dur.
    return Promise.resolve(null);
  }
}

// ---------------------------------------------------------------- belge kökü işaretleri
let paused = false;
let connected = false;
function applyFlags() {
  root.dataset.emlaksoftListingBridge = "1";
  root.dataset.emlaksoftListingVersion = VERSION;
  if (connected) root.dataset.emlaksoftListingConnected = "1";
  else delete root.dataset.emlaksoftListingConnected;
  if (paused) root.dataset.emlaksoftListingPaused = "1";
  else delete root.dataset.emlaksoftListingPaused;
  // Otomatik kontrol yalnız bağlıyken ve duraklatılmamışken: sayfa içi işçi o zaman iş talep etmez (çift kontrol olmaz).
  if (connected && !paused) root.dataset.emlaksoftListingAutorun = "1";
  else delete root.dataset.emlaksoftListingAutorun;
}
applyFlags();

function postReady() {
  window.postMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "ready", version: VERSION }, window.location.origin);
}

function readFlags(value: unknown) {
  const f = (typeof value === "object" && value !== null ? value : {}) as { connected?: boolean; paused?: boolean };
  connected = f.connected === true;
  paused = f.paused === true;
  applyFlags();
}

void chrome.storage.local.get(STORAGE_KEYS.flags).then((v) => {
  readFlags(v[STORAGE_KEYS.flags]);
  // Bayrakları tazele (rozet/bağlantı süresi): service worker durumu hesaplayıp yeniden yazar.
  void send({ kind: "status" });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(STORAGE_KEYS.flags in changes)) return;
  const wasActive = connected && !paused;
  readFlags(changes[STORAGE_KEYS.flags]?.newValue);
  if (connected && !paused && !wasActive) schedule(2_000);
});

// ---------------------------------------------------------------- köprü (sayfa ↔ eklenti)
function reply(message: Record<string, unknown>) {
  window.postMessage({ source: BRIDGE_RESPONSE_SOURCE, ...message }, window.location.origin);
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const d = event.data as Record<string, unknown> | null;
  if (!d || d.source !== BRIDGE_REQUEST_SOURCE) return;

  if (d.type === "connect-request") {
    const nonce = typeof d.nonce === "string" ? d.nonce.slice(0, 64) : "";
    const trusted = isTrustedConnectRequest({
      fromSameWindow: event.source === window,
      eventOrigin: event.origin,
      locationOrigin: window.location.origin,
      allowedOrigins: __EMLAKSOFT_APP_ORIGINS__,
      userActive: navigator.userActivation?.isActive === true,
      data: d,
    });
    if (!trusted) {
      reply({ type: "connect-response", nonce, ok: false });
      return;
    }
    void send<{ connected?: boolean }>({ kind: "setConnected", connected: true }).then((status) => {
      reply({ type: "connect-response", nonce, ok: status?.connected === true });
    });
    return;
  }

  if (d.type === "scan-request") {
    const nonce = typeof d.nonce === "string" ? d.nonce.slice(0, 64) : "";
    const trusted = isTrustedScanRequest({
      fromSameWindow: event.source === window,
      eventOrigin: event.origin,
      locationOrigin: window.location.origin,
      allowedOrigins: __EMLAKSOFT_APP_ORIGINS__,
      data: d,
    });
    if (!trusted || !connected || paused) {
      reply({ type: "scan-response", nonce, ok: false });
      return;
    }
    void send({ kind: "scanNow" }).then((status) => reply({ type: "scan-response", nonce, ok: status !== null }));
    return;
  }

  if (d.type === "transfer-request") {
    const nonce = typeof d.nonce === "string" ? d.nonce.slice(0, 64) : "";
    const trusted = isTrustedTransferRequest({
      fromSameWindow: event.source === window,
      eventOrigin: event.origin,
      locationOrigin: window.location.origin,
      allowedOrigins: __EMLAKSOFT_APP_ORIGINS__,
      data: d,
    });
    if (!trusted) {
      reply({ type: "transfer-response", nonce, ok: false, photos: 0, total: 0, message: "İstek doğrulanamadı." });
      return;
    }
    void runTransfer(String(d.code)).then((r) => reply({ type: "transfer-response", nonce, ...r }));
    return;
  }

  const id = typeof d.id === "string" && d.id.length > 0 && d.id.length <= 64 ? d.id : null;
  if (!id) return;

  if (d.type === "status-request") {
    void send({ kind: "status" }).then((status) => reply({ type: "status-response", id, status }));
    return;
  }

  const portal = typeof d.portal === "string" ? d.portal.slice(0, 40) : "";
  const url = typeof d.url === "string" ? d.url.slice(0, 2048) : "";
  if (!portal || !url) return;
  if (d.type === "verify-request") {
    const externalId = typeof d.externalId === "string" ? d.externalId.slice(0, 40) : null;
    void send({ kind: "probe", job: { portal, url, externalId }, wait: false }).then((r) => {
      reply({ type: "verify-response", id, reply: r ?? { error: "busy" } });
    });
  } else if (d.type === "inventory-request") {
    void send({ kind: "inventory", job: { portal, url } }).then((r) => {
      reply({ type: "inventory-response", id, reply: r ?? { items: [], nextUrl: null, error: "busy" } });
    });
  }
});

postReady();
document.addEventListener("DOMContentLoaded", postReady);
window.addEventListener("load", postReady);
// EmlakSoft sekmesi görüldü (popup "bağlan" yönlendirmesi için); oturum durumu döngüde belirlenir.
void send({ kind: "appSeen", session: "unknown" });

// ---------------------------------------------------------------- otomatik kontrol döngüsü (lider sekme)
type ApiReply = { ok?: boolean; error?: string; outcome?: string; clientId?: string; status?: string; jobs?: Job[] };
type Job = { jobId: string; listingId: string; portal: string; externalId: string | null; url: string | null };

let clientId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let errors = 0;
let stopped = false;

async function api(body: Record<string, unknown>, endpoint: string = BRIDGE_ENDPOINT, extraHeaders: Record<string, string> = {}): Promise<{ status: number; data: ApiReply }> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", [BRIDGE_HEADER]: "1", ...extraHeaders },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as ApiReply;
    return { status: res.status, data };
  } catch {
    return { status: 0, data: { ok: false, error: "network" } };
  }
}

function schedule(ms: number) {
  if (stopped) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void tick(), ms);
}

/** Kuyruktaki (gönderilemeyen) sonuçları AYNI iş kimliğiyle yeniden gönderir. Portal sorgusu YOK. */
async function flushOutbox(): Promise<void> {
  const due = await send<{ entries?: OutboxEntry[] }>({ kind: "outboxDue" });
  for (const e of due?.entries ?? []) {
    const r = await api({ op: "complete", clientId: e.clientId, jobId: e.jobId, result: e.result, observed: e.observed, parser: e.telemetry });
    const verdict = sendVerdict(r.status, r.data);
    await send({ kind: verdict === "retry" ? "outboxFail" : "outboxDone", jobId: e.jobId });
    if (verdict === "retry") break; // ağ hâlâ yok: kalanlar sonraki turda
  }
}

/**
 * Günlük mağaza taramasının sonucunu EmlakSoft'a yükler (kullanıcının açık oturumuyla, aynı kökenli uca). Başarısızsa
 * (ağ/5xx/oturum) service worker kuyruğunda kalır ve üstel geri çekilmeyle yeniden denenir; tarama TEKRARLANMAZ.
 */
async function flushScans(): Promise<void> {
  const due = await send<{ entries?: ScanUpload[] }>({ kind: "scanPendingDue" });
  for (const u of due?.entries ?? []) {
    const r = await api(
      { portal: u.portal, kind: u.kind, complete: u.complete, expected: u.expected, read: u.read, reason: u.reason, items: u.items, parserVersion: u.parserVersion },
      BRIDGE_INVENTORY_ENDPOINT,
    );
    const verdict = sendVerdict(r.status, r.data);
    await send({ kind: verdict === "retry" ? "scanPendingFail" : "scanPendingDone", id: u.id });
    if (verdict === "retry") break;
  }
}

/**
 * (0.4.0) Kullanıcının popup'ta onayladığı sahibinden ilan kayıtlarını EmlakSoft'a gönderir (açık oturumla, aynı kökenli uç).
 * Otomatik kontrol bağlantısından BAĞIMSIZDIR (kuyruk yalnız kullanıcı "Kaydet" dediğinde dolar); portal sayfası okunmaz.
 * Başarısızsa (ağ/oturum/5xx) kuyrukta kalır, üstel geri çekilmeyle yeniden denenir; sunucu idempotenttir.
 */
let fsboFlushing = false;
async function flushFsbo(): Promise<void> {
  if (fsboFlushing) return;
  fsboFlushing = true;
  try {
    const due = await send<{ entries?: FsboPending[] }>({ kind: "fsboPendingDue" });
    for (const e of due?.entries ?? []) {
      const r = await api(e.payload as unknown as Record<string, unknown>, BRIDGE_FSBO_ENDPOINT);
      const data = r.data as ApiReply & { created?: boolean; ownedByOther?: string | null };
      const verdict = sendVerdict(r.status, data);
      if (verdict === "retry") {
        await send({ kind: "fsboPendingFail", id: e.id });
        break;
      }
      const summary = data.ok
        ? data.ownedByOther
          ? String(data.ownedByOther)
          : data.created === false
            ? "İlan zaten kayıtlıydı; yeni fiyat gözlemi eklendi."
            : "EmlakSoft'a kaydedildi."
        : "Kayıt reddedildi.";
      await send({ kind: "fsboPendingDone", id: e.id, summary });
    }
  } finally {
    fsboFlushing = false;
  }
}

/**
 * (0.5.0) Portala aktar: sayfanın verdiği TEK KULLANIMLIK kodu aynı kökenli uçta tüketir (kullanıcının açık oturumu), paketi
 * service worker'a, fotoğrafları (aynı kökenli yetkili medya ucundan indirilip ≤1600 px JPEG'e küçültülerek) oturum deposuna koyar.
 * Portala HİÇBİR istek atılmaz; formu kullanıcı portal sekmesinde eklenti penceresinden doldurur ve "Yayınla"ya kendisi basar.
 */
async function downscaleToJpegB64(blob: Blob, mark: OffscreenCanvas | null, wm: TransferWatermark | null): Promise<{ b64: string; type: string } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const size = scaledSize(bmp.width, bmp.height, PHOTO_MAX_SIDE);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, size.width, size.height);
    bmp.close();
    if (mark && wm) stampTransferMark(ctx, size.width, size.height, mark, wm.settings);
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_JPEG_QUALITY });
    return { b64: bytesToBase64(new Uint8Array(await out.arrayBuffer())), type: "image/jpeg" };
  } catch {
    // Çözülemeyen biçim: küçükse olduğu gibi (arka plan 1,5 MB üstünü zaten reddeder).
    if (blob.size > 1_000_000) return null;
    return { b64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), type: blob.type || "image/jpeg" };
  }
}

async function runTransfer(code: string): Promise<{ ok: boolean; photos: number; total: number; message: string }> {
  const fail = (message: string) => ({ ok: false, photos: 0, total: 0, message });
  // Doldurmadan önce kurallar 1 saatten eskiyse tazelenir (başarısızlık aktarımı durdurmaz: son iyi sürüm / tohum).
  await refreshRules(RULES_MAX_AGE_TRANSFER_MS).catch(() => undefined);
  const r = await api({ code }, BRIDGE_TRANSFER_FETCH_ENDPOINT);
  const data = r.data as ApiReply & { sessionId?: string; payload?: { photos?: { id?: unknown; fileName?: unknown }[] }; message?: string };
  if (!data.ok || typeof data.sessionId !== "string") return fail(typeof data.message === "string" ? data.message : "Aktarım paketi alınamadı.");
  const put = await send<{ ok?: boolean }>({ kind: "transferPut", data });
  if (!put?.ok) return fail("Paket eklentiye alınamadı.");
  const photos = Array.isArray(data.payload?.photos) ? data.payload.photos : [];
  // Ofis filigranı açıksa her fotoğrafa basılır (EmlakSoft'taki orijinal değişmez); logo yüklenemezse metne düşülür.
  const wm = sanitizeTransferWatermark((data as { watermark?: unknown }).watermark);
  let mark: OffscreenCanvas | null = null;
  if (wm) {
    let logo: ImageBitmap | null = null;
    if (wm.logoUrl) {
      try {
        const lr = await fetch(wm.logoUrl, { mode: "cors", credentials: "omit" });
        if (lr.ok) logo = await createImageBitmap(await lr.blob());
      } catch {
        logo = null;
      }
    }
    mark = buildTransferMark(wm, logo);
    logo?.close();
  }
  let used = 0;
  let stored = 0;
  let skipped = 0;
  for (let i = 0; i < photos.length; i += 1) {
    const mediaId = typeof photos[i]?.id === "string" ? (photos[i]!.id as string) : "";
    if (!mediaId) {
      skipped += 1;
      continue;
    }
    try {
      const res = await fetch(`${BRIDGE_MEDIA_PATH}/${encodeURIComponent(mediaId)}/download`, { credentials: "same-origin" });
      if (!res.ok) {
        skipped += 1;
        continue;
      }
      const prepared = await downscaleToJpegB64(await res.blob(), mark, wm);
      const decision = prepared ? photoBudget(used, prepared.b64.length) : { take: false };
      if (!prepared || !decision.take) {
        skipped += 1;
        continue;
      }
      const base = typeof photos[i]?.fileName === "string" ? String(photos[i]!.fileName).replace(/\.[A-Za-z0-9]{2,5}$/, "") : `foto-${i + 1}`;
      const ok = await send<{ ok?: boolean }>({ kind: "transferPhoto", sessionId: data.sessionId, index: i, name: `${base}.jpg`, type: prepared.type, b64: prepared.b64 });
      if (ok?.ok) {
        used += prepared.b64.length;
        stored += 1;
      } else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  await send({ kind: "transferPhotosDone", sessionId: data.sessionId, skipped });
  return { ok: true, photos: stored, total: photos.length, message: photoSummary(stored, photos.length) };
}

/** (0.5.0) Yayın sonrası ilan no/URL geri bağlama kuyruğu (kullanıcı popup'ta "EmlakSoft'a bağla" dediğinde dolar). */
let doneFlushing = false;
async function flushTransferDone(): Promise<void> {
  if (doneFlushing) return;
  doneFlushing = true;
  try {
    const due = await send<{ entries?: QueueEntry<DonePayload>[] }>({ kind: "transferDoneDue" });
    for (const e of due?.entries ?? []) {
      // Boş alan raporu GÖNDERİLMEZ (gönderilirse "filled" anındaki rapor sunucuda {} ile ezilirdi).
      const body = { ...(e.payload as unknown as Record<string, unknown>) };
      if (typeof body.report !== "object" || body.report === null || Object.keys(body.report).length === 0) delete body.report;
      const r = await api(body, BRIDGE_TRANSFER_DONE_ENDPOINT);
      const data = r.data as ApiReply & { message?: string };
      const verdict = sendVerdict(r.status, data);
      if (verdict === "retry") {
        await send({ kind: "transferDoneFail", id: e.id });
        break;
      }
      await send({ kind: "transferDoneAck", id: e.id, ok: data.ok === true, summary: typeof data.message === "string" ? data.message : data.ok ? "Kaydedildi." : "Reddedildi." });
    }
  } finally {
    doneFlushing = false;
  }
}

/** (0.5.0) Kullanıcının İlanlarım sayfasından SEÇTİĞİ ilanlar: EmlakSoft'a taslak portföy olarak gönderilir (sunucu mükerrer kontrolü yapar). */
let importFlushing = false;
async function flushImport(): Promise<void> {
  if (importFlushing) return;
  importFlushing = true;
  try {
    const due = await send<{ entries?: QueueEntry<ImportPayload>[] }>({ kind: "importDue" });
    for (const e of due?.entries ?? []) {
      const r = await api(e.payload as unknown as Record<string, unknown>, BRIDGE_IMPORT_ENDPOINT);
      const data = r.data as ApiReply & { summary?: string; message?: string };
      const verdict = sendVerdict(r.status, data);
      if (verdict === "retry") {
        await send({ kind: "importFail", id: e.id });
        break;
      }
      await send({ kind: "importAck", id: e.id, ok: data.ok === true, summary: data.ok ? String(data.summary ?? "Eklendi.") : String(data.message ?? "Reddedildi.") });
    }
  } finally {
    importFlushing = false;
  }
}

/**
 * (0.6.0) KURAL TAZELEME: aynı kökenli kural ucundan (oturum + köken + köprü başlığı + eklenti sürümü; ETag) ham yanıtı
 * alır ve service worker'a verir. Doğrulama (boyut, şema, sürüm, sha256, ECDSA imzası) ve depo yazımı YALNIZ arka plandadır;
 * burada hiçbir karar verilmez. Portala istek yok. Hata olursa üstel bekleme (5 dk → 6 sa) arka plandaki meta'dan hesaplanır.
 */
const RULES_MAX_AGE_PAGE_MS = 6 * 3_600_000;
const RULES_MAX_AGE_TRANSFER_MS = 3_600_000;
const RULES_TIMEOUT_MS = 20_000;
let rulesRefreshing = false;
async function refreshRules(maxAgeMs: number): Promise<void> {
  if (rulesRefreshing || !navigator.onLine) return;
  const status = await send<{ meta?: RulesMeta }>({ kind: "rulesStatus" });
  if (!status?.meta || !rulesRefreshDue(status.meta, Date.now(), maxAgeMs)) return;
  rulesRefreshing = true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RULES_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { [BRIDGE_HEADER]: "1", [EXT_VERSION_HEADER]: VERSION };
    if (status.meta.etag) headers["If-None-Match"] = status.meta.etag;
    const res = await fetch(`${BRIDGE_RULES_ENDPOINT}?engine=${FORM_RULES_ENGINE}`, { method: "GET", credentials: "same-origin", cache: "no-store", signal: ctrl.signal, headers });
    if (res.status === 304) await send({ kind: "rulesMeta", notModified: true });
    else if (res.status === 200) await send({ kind: "rulesPut", raw: (await res.text()).slice(0, 300_000), etag: res.headers.get("etag") });
    else await send({ kind: "rulesMeta", error: `http_${res.status}` });
  } catch {
    await send({ kind: "rulesMeta", error: ctrl.signal.aborted ? "timeout" : "network" });
  } finally {
    clearTimeout(timer);
    rulesRefreshing = false;
  }
}

/**
 * (0.6.0) Form şeması + düzeltme sinyali kuyruğu (YALNIZ açık rızayla dolar; arka plan her turda rızayı yeniden okur ve rıza
 * yoksa kuyruğu siler). 2xx ve kalıcı reddi (400/413/426) düşer; ağ/5xx/oturum/hız yeniden denenir.
 */
let feedbackFlushing = false;
async function flushFeedback(): Promise<void> {
  if (feedbackFlushing) return;
  feedbackFlushing = true;
  try {
    const due = await send<{ entries?: QueueEntry<FeedbackPayload>[] }>({ kind: "feedbackDue" });
    for (const e of due?.entries ?? []) {
      const r = await api(e.payload as unknown as Record<string, unknown>, BRIDGE_FEEDBACK_ENDPOINT, { [EXT_VERSION_HEADER]: VERSION });
      const drop = (r.status >= 200 && r.status < 300) || r.status === 400 || r.status === 413 || r.status === 426;
      if (!drop) {
        await send({ kind: "feedbackFail", id: e.id });
        break;
      }
      await send({ kind: "feedbackAck", id: e.id });
    }
  } finally {
    feedbackFlushing = false;
  }
}

async function step(): Promise<StepOutcome | "wait"> {
  if (paused || !connected) return "idle";
  if (!navigator.onLine) return "busy";
  const lease = await send<{ granted: boolean }>({ kind: "lease", token: TAB_TOKEN });
  if (!lease?.granted) return "wait";
  await flushOutbox();
  await flushScans();
  const gate = await send<{ ok: boolean; waitMs?: number }>({ kind: "canFetch" });
  if (!gate?.ok) return "busy";

  if (!clientId) {
    const key = await send<{ deviceKey: string }>({ kind: "deviceKey" });
    if (!key?.deviceKey) return "error";
    const reg = await api({ op: "register", deviceKey: key.deviceKey, version: VERSION });
    if (reg.status === 401) {
      void send({ kind: "appSeen", session: "login_required" });
      return "client_invalid";
    }
    if (!reg.data.ok || !reg.data.clientId) {
      if (reg.data.error === "forbidden") {
        stopped = true; // yetkisiz kullanıcı: bu sayfada bir daha denenmez
        void send({ kind: "appSeen", session: "forbidden" });
      }
      return "client_invalid";
    }
    clientId = reg.data.clientId;
  }

  const claim = await api({ op: "claim", clientId });
  if (claim.status === 401) {
    void send({ kind: "appSeen", session: "login_required" });
    return "client_invalid";
  }
  if (!claim.data.ok) {
    if (claim.data.error === "client_invalid" || claim.data.outcome === "client_invalid") clientId = null;
    return "error";
  }
  void send({ kind: "appSeen", session: "ok" });
  if (claim.data.status === "busy") return "busy";
  if (claim.data.status === "rate_limited") return "rate_limited";
  const job = claim.data.jobs?.[0];
  if (!job) return "idle";
  if (!job.url) {
    await api({ op: "release", clientId, jobId: job.jobId, reason: "no_url" });
    return "done";
  }
  const probeReply = await send<{ error?: string } & Record<string, unknown>>({
    kind: "probe",
    job: { portal: job.portal, url: job.url, externalId: job.externalId },
    wait: true,
  });
  const deferred = ["busy", "paused", "not_connected", "portal_disabled"];
  if (!probeReply || (typeof probeReply.error === "string" && deferred.includes(probeReply.error))) {
    await api({ op: "release", clientId, jobId: job.jobId, reason: `bridge_${probeReply?.error ?? "unavailable"}` });
    return "busy";
  }
  const report = replyToReport(probeReply, new Date().toISOString());
  const telemetry = buildTelemetry(job.portal, probeReply);
  const body = { op: "complete", clientId, jobId: job.jobId, result: report.result, observed: report.observed, parser: telemetry };
  const done = await api(body);
  const verdict = sendVerdict(done.status, done.data);
  if (verdict === "retry") {
    // İdempotent yeniden deneme için sakla (aynı iş kimliği); portal tekrar sorgulanmaz.
    await send({ kind: "outboxPut", entry: { jobId: job.jobId, clientId, result: report.result, observed: report.observed, telemetry } });
    return "error";
  }
  return verdict === "done" ? "done" : "error";
}

async function tick() {
  if (running || stopped) return;
  running = true;
  let outcome: StepOutcome | "wait" = "error";
  try {
    outcome = await step();
  } catch {
    outcome = "error";
  }
  running = false;
  if (outcome === "error") errors += 1;
  else if (outcome === "done") errors = 0;
  // Lider değilse kısa aralıkla yokla (lider sekme kapanınca devralmak için).
  schedule(outcome === "wait" ? 45_000 : nextDelayMs(outcome, errors, Math.random()));
}

if (window.location.pathname === "/app" || window.location.pathname.startsWith("/app/")) {
  schedule(5_000);
  window.addEventListener("pagehide", () => {
    stopped = true;
    void send({ kind: "releaseLease", token: TAB_TOKEN });
  });
  // Geri/ileri önbelleğinden dönen sayfa döngüyü yeniden başlatır.
  window.addEventListener("pageshow", (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    stopped = false;
    schedule(5_000);
  });
}

// (0.4.0) Sahibinden ilan kayıt kuyruğu: sayfa açılınca, kuyruk değişince ve çevrimiçi olunca (yalnız EmlakSoft kökeninde).
void flushFsbo();
void flushTransferDone();
void flushImport();
void flushFeedback();
void refreshRules(RULES_MAX_AGE_PAGE_MS);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (STORAGE_KEYS.fsboPending in changes) void flushFsbo();
  if (STORAGE_KEYS.transferDone in changes) void flushTransferDone();
  if (STORAGE_KEYS.importPending in changes) void flushImport();
  if (STORAGE_KEYS.feedback in changes) void flushFeedback();
});
window.addEventListener("online", () => {
  void flushFsbo();
  void flushTransferDone();
  void flushImport();
  void flushFeedback();
});
