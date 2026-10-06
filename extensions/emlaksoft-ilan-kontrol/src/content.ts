import { BRIDGE_REQUEST_SOURCE, BRIDGE_RESPONSE_SOURCE } from "@/lib/listing-control/worker/bridge";
import { nextDelayMs, replyToReport, type StepOutcome } from "@/lib/listing-control/worker/core";
import { BRIDGE_ENDPOINT, BRIDGE_HEADER } from "@/lib/listing-control/worker/bridge-request";
import { STORAGE_KEYS, type BgRequest } from "./messages";

/**
 * İÇERİK BETİĞİ (yalnız EmlakSoft alanında çalışır; manifest `content_scripts.matches`). İki iş:
 *  1) KÖPRÜ: belge köküne `data-emlaksoft-listing-bridge="1"` koyar, `ready` iletir ve sayfanın `verify-request` /
 *     `inventory-request` iletilerini service worker'a taşır (sözleşme `src/lib/listing-control/worker/bridge.ts`).
 *  2) OTOMATİK KONTROL: kullanıcı EmlakSoft'ta oturum açmışken (herhangi bir /app sayfası) ve eklenti duraklatılmamışken,
 *     açık sekmelerden YALNIZ BİRİ (lider kirası) sıradaki işi aynı kökendeki `/api/app/ilan-kontrol/isci` ucundan alır,
 *     service worker'a kontrol ettirir ve sonucu bildirir. Sekme kapanınca kira bırakılır; hiç sekme yoksa kontrol yoktur.
 */

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
function applyFlags() {
  root.dataset.emlaksoftListingBridge = "1";
  if (paused) {
    root.dataset.emlaksoftListingPaused = "1";
    delete root.dataset.emlaksoftListingAutorun;
  } else {
    delete root.dataset.emlaksoftListingPaused;
    root.dataset.emlaksoftListingAutorun = "1";
  }
}
applyFlags();

function postReady() {
  window.postMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "ready", version: VERSION }, window.location.origin);
}

void chrome.storage.local.get(STORAGE_KEYS.paused).then((v) => {
  paused = v[STORAGE_KEYS.paused] === true;
  applyFlags();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(STORAGE_KEYS.paused in changes)) return;
  paused = changes[STORAGE_KEYS.paused]?.newValue === true;
  applyFlags();
  if (!paused) schedule(2_000);
});

// ---------------------------------------------------------------- köprü (sayfa ↔ eklenti)
window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const d = event.data as Record<string, unknown> | null;
  if (!d || d.source !== BRIDGE_REQUEST_SOURCE) return;
  const id = typeof d.id === "string" && d.id.length > 0 && d.id.length <= 64 ? d.id : null;
  const portal = typeof d.portal === "string" ? d.portal.slice(0, 40) : "";
  const url = typeof d.url === "string" ? d.url.slice(0, 2048) : "";
  if (!id || !portal || !url) return;
  if (d.type === "verify-request") {
    const externalId = typeof d.externalId === "string" ? d.externalId.slice(0, 40) : null;
    void send({ kind: "probe", job: { portal, url, externalId }, wait: false }).then((reply) => {
      window.postMessage({ source: BRIDGE_RESPONSE_SOURCE, type: "verify-response", id, reply: reply ?? { error: "busy" } }, window.location.origin);
    });
  } else if (d.type === "inventory-request") {
    void send({ kind: "inventory", job: { portal, url } }).then((reply) => {
      window.postMessage(
        { source: BRIDGE_RESPONSE_SOURCE, type: "inventory-response", id, reply: reply ?? { items: [], nextUrl: null, error: "busy" } },
        window.location.origin,
      );
    });
  }
});

postReady();
document.addEventListener("DOMContentLoaded", postReady);
window.addEventListener("load", postReady);

// ---------------------------------------------------------------- otomatik kontrol döngüsü (lider sekme)
type ApiReply = { ok?: boolean; error?: string; outcome?: string; clientId?: string; status?: string; jobs?: Job[] };
type Job = { jobId: string; listingId: string; portal: string; externalId: string | null; url: string | null };

let clientId: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let errors = 0;
let stopped = false;

async function api(body: Record<string, unknown>): Promise<{ status: number; data: ApiReply }> {
  try {
    const res = await fetch(BRIDGE_ENDPOINT, {
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

async function step(): Promise<StepOutcome | "wait"> {
  if (paused) return "idle";
  const lease = await send<{ granted: boolean }>({ kind: "lease", token: TAB_TOKEN });
  if (!lease?.granted) return "wait";
  const gate = await send<{ ok: boolean; waitMs?: number }>({ kind: "canFetch" });
  if (!gate?.ok) return "busy";

  if (!clientId) {
    const key = await send<{ deviceKey: string }>({ kind: "deviceKey" });
    if (!key?.deviceKey) return "error";
    const reg = await api({ op: "register", deviceKey: key.deviceKey, version: VERSION });
    if (reg.status === 401) return "client_invalid";
    if (!reg.data.ok || !reg.data.clientId) {
      if (reg.data.error === "forbidden") stopped = true; // yetkisiz kullanıcı: bu sayfada bir daha denenmez
      return "client_invalid";
    }
    clientId = reg.data.clientId;
  }

  const claim = await api({ op: "claim", clientId });
  if (claim.status === 401) return "client_invalid";
  if (!claim.data.ok) {
    if (claim.data.error === "client_invalid" || claim.data.outcome === "client_invalid") clientId = null;
    return "error";
  }
  if (claim.data.status === "busy") return "busy";
  if (claim.data.status === "rate_limited") return "rate_limited";
  const job = claim.data.jobs?.[0];
  if (!job) return "idle";
  if (!job.url) {
    await api({ op: "release", clientId, jobId: job.jobId, reason: "no_url" });
    return "done";
  }
  const reply = await send<{ error?: string } & Record<string, unknown>>({
    kind: "probe",
    job: { portal: job.portal, url: job.url, externalId: job.externalId },
    wait: true,
  });
  if (!reply || reply.error === "busy" || reply.error === "paused") {
    await api({ op: "release", clientId, jobId: job.jobId, reason: `bridge_${reply?.error ?? "unavailable"}` });
    return "busy";
  }
  const report = replyToReport(reply, new Date().toISOString());
  const done = await api({ op: "complete", clientId, jobId: job.jobId, result: report.result, observed: report.observed });
  return done.data.ok ? "done" : "error";
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
