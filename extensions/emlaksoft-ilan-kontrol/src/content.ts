import { BRIDGE_REQUEST_SOURCE, BRIDGE_RESPONSE_SOURCE } from "@/lib/listing-control/worker/bridge";
import { nextDelayMs, replyToReport, type StepOutcome } from "@/lib/listing-control/worker/core";
import { BRIDGE_ENDPOINT, BRIDGE_HEADER, BRIDGE_INVENTORY_ENDPOINT } from "@/lib/listing-control/worker/bridge-request";
import type { ScanUpload } from "@/lib/listing-control/worker/extension-scan";
import { sendVerdict, type OutboxEntry } from "@/lib/listing-control/worker/extension-outbox";
import { isTrustedConnectRequest } from "@/lib/listing-control/worker/extension-pairing";
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

async function api(body: Record<string, unknown>, endpoint: string = BRIDGE_ENDPOINT): Promise<{ status: number; data: ApiReply }> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", [BRIDGE_HEADER]: "1" },
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
