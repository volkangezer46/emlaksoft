import { getHtmlAdapter, listHtmlAdapters, PARSER_VERSION, type FetchedPage } from "@/lib/listing-control/adapters/html";
import { MAX_HTML_CHARS } from "@/lib/listing-control/adapters/html/parse-core";
import {
  applyBlockCooldown,
  INITIAL_PACING,
  leaseDecision,
  localDayKey,
  pacingDecision,
  recordRequest,
  releaseLease,
  type Lease,
  type PacingState,
} from "@/lib/listing-control/worker/extension-pacing";
import type { ProbeReply } from "@/lib/listing-control/worker/core";
import { badgeFor, bumpHistory, entryFromReply, classifyReply, pushRecent, recordHealth, type HealthMap, type History, type RecentItem } from "@/lib/listing-control/worker/extension-health";
import { dueEntries, enqueue, markDone, markFailed, prune, type OutboxEntry } from "@/lib/listing-control/worker/extension-outbox";
import { isPairingActive, isTrustedSender, type Pairing } from "@/lib/listing-control/worker/extension-pairing";
import { DEFAULT_SETTINGS, portalEnabled, sanitizeSettings, withinWorkingHours, type ExtensionSettings } from "@/lib/listing-control/worker/extension-settings";
import { buildStatusView, type AppSession, type ExtensionStatusView, type StatusInput } from "@/lib/listing-control/worker/extension-status-view";
import { ALARM_TICK, STORAGE_KEYS, type BgRequest } from "./messages";

/**
 * SERVICE WORKER: bütün portal isteklerinin TEK geçidi. Yalnız manifest'teki portal alanlarına, kullanıcının kendi
 * tarayıcı oturumuyla (`credentials: "include"`), yeni sekme AÇMADAN istek atar; sayfayı saf ayrıştırıcıyla
 * (`src/lib/listing-control/adapters/html`) okur. Hız kuralı ve lider kirası `extension-pacing.ts`'ten gelir.
 * YASAK (yapılmaz): CAPTCHA çözme/atlatma, kullanıcı ajanı taklidi, IP/çerez oyunu, hız sınırını aşma, giriş bilgisi
 * isteme. Engel görülünce 30 dk durulur ve sonuç "kontrol edilemedi" olarak bildirilir.
 *
 * TEK TUŞ: kullanıcı "Bağlan" demeden (popup ya da uygulama içi sayfa) HİÇBİR portal isteği yapılmaz. Ayarlar (portal aç/kapa,
 * çalışma saatleri, günlük sınır) yalnız KISAR. MV3: service worker her an uyuyabilir; durum `chrome.storage`'da, uyandırma
 * `chrome.alarms` (dakikada bir rozet/bayrak tazeleme) ve gelen iletilerledir.
 */

declare const __EMLAKSOFT_APP_ORIGINS__: string[];

const FETCH_TIMEOUT_MS = 20_000;
/** Sayfa içi işçiden gelen istekte beklenmez (zaman aşımı 25 sn); otomatik döngü ve liste okumada kısa bekleme kabul. */
const MAX_WAIT_MS = 35_000;
const PORTAL_IDS = listHtmlAdapters().map((a) => a.id);

type Stats = { lastAt: number | null; lastKind: StatusInput["lastKind"]; lastError: string | null };
type AppState = { seenAt: number | null; session: AppSession; okAt: number | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayKey = () => localDayKey(Date.now(), new Date().getTimezoneOffset());
const tz = () => new Date().getTimezoneOffset();

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const v = (await chrome.storage.local.get(key))[key];
  return (v as T | undefined) ?? fallback;
}
const setLocal = (key: string, value: unknown) => chrome.storage.local.set({ [key]: value });

// Depo okuma-değiştirme-yazma işlemleri tek kuyrukta (eşzamanlı iletiler birbirinin üstüne yazmasın).
let storeChain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const p = storeChain.then(fn, fn);
  storeChain = p.catch(() => undefined);
  return p;
}

// Tek service worker örneği içinde portal istekleri SIRAYLA gider (eşzamanlı istek yok).
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

const isPaused = async () => (await getLocal<boolean>(STORAGE_KEYS.paused, false)) === true;
const getPairing = () => getLocal<Pairing>(STORAGE_KEYS.pairing, null);
const getApp = () => getLocal<AppState>(STORAGE_KEYS.app, { seenAt: null, session: "unknown", okAt: null });
const getSettings = async (): Promise<ExtensionSettings> => sanitizeSettings(await getLocal<unknown>(STORAGE_KEYS.settings, DEFAULT_SETTINGS));

async function getPacing(): Promise<PacingState> {
  return { ...INITIAL_PACING, ...(await getLocal<Partial<PacingState>>(STORAGE_KEYS.pacing, {})) };
}
const setPacing = (s: PacingState) => setLocal(STORAGE_KEYS.pacing, s);

async function getLease(): Promise<Lease> {
  const v = (await chrome.storage.session.get(STORAGE_KEYS.lease))[STORAGE_KEYS.lease];
  return (v as Lease | undefined) ?? null;
}

async function isConnected(): Promise<boolean> {
  const [pairing, app] = await Promise.all([getPairing(), getApp()]);
  return isPairingActive(pairing, app.okAt, Date.now());
}

// ---------------------------------------------------------------- durum görünümü, rozet, bayraklar

async function loadInput(): Promise<StatusInput> {
  const [paused, pacing, pairing, app, settings, health, history, recent, stats, outbox, lease] = await Promise.all([
    isPaused(),
    getPacing(),
    getPairing(),
    getApp(),
    getSettings(),
    getLocal<HealthMap>(STORAGE_KEYS.health, {}),
    getLocal<History>(STORAGE_KEYS.history, {}),
    getLocal<RecentItem[]>(STORAGE_KEYS.recent, []),
    getLocal<Stats>(STORAGE_KEYS.stats, { lastAt: null, lastKind: null, lastError: null }),
    getLocal<OutboxEntry[]>(STORAGE_KEYS.outbox, []),
    getLease(),
  ]);
  const nowMs = Date.now();
  return {
    version: chrome.runtime.getManifest().version,
    parserVersion: PARSER_VERSION,
    pairing,
    lastSessionOkAt: app.okAt,
    appSession: app.session,
    appSeenAt: app.seenAt,
    paused,
    pacing,
    settings,
    health,
    history,
    recent,
    lastAt: stats.lastAt,
    lastKind: stats.lastKind,
    lastError: stats.lastError,
    outboxCount: outbox.length,
    leaderActive: !!lease && lease.expiresAtMs > nowMs,
    portalIds: PORTAL_IDS,
    nowMs,
    dayKey: dayKey(),
    tzOffsetMinutes: tz(),
  };
}

const BADGE_COLORS = { green: "#047857", amber: "#b45309", red: "#b91c1c", gray: "#64748b" } as const;

/** Görünümü hesaplar, türetilmiş bayrakları (içerik betiği için) ve araç çubuğu rozetini günceller. */
async function refresh(): Promise<ExtensionStatusView> {
  const view = buildStatusView(await loadInput());
  const flags = { connected: view.connected, paused: view.paused };
  const prev = await getLocal<{ connected?: boolean; paused?: boolean } | null>(STORAGE_KEYS.flags, null);
  if (!prev || prev.connected !== flags.connected || prev.paused !== flags.paused) await setLocal(STORAGE_KEYS.flags, flags);
  try {
    const b = badgeFor({ connected: view.connected, paused: view.paused, cooldownActive: view.cooldownUntil > Date.now(), warnPortals: view.warnPortals });
    await chrome.action.setBadgeText({ text: b.text });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[b.color] });
    await chrome.action.setTitle({ title: b.title });
  } catch {
    /* rozet güncellenemedi: kritik değil */
  }
  return view;
}

// ---------------------------------------------------------------- portal istekleri

async function fetchPage(url: string): Promise<FetchedPage | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      signal: ctrl.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    const ct = res.headers.get("content-type") ?? "";
    const html = !ct || /html|text/i.test(ct) ? (await res.text()).slice(0, MAX_HTML_CHARS) : "";
    return { status: res.status, finalUrl: res.url || url, html };
  } catch {
    return { error: ctrl.signal.aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hız kuralıyla tek portal isteği. Beklenemiyorsa `busy`, duraklatılmışsa `paused`, bağlı değilse `not_connected`
 * (gözlem DEĞİL; iş geri bırakılır). Çalışma saati dışında ve günlük/saatlik tavanda `busy`. Kullanıcı ayarı yalnız kısar.
 */
async function paced<T extends { error?: string | null }>(wait: boolean, run: () => Promise<T>): Promise<T | { error: "busy" | "paused" | "not_connected" }> {
  return serialize(async () => {
    if (!(await isConnected())) return { error: "not_connected" as const };
    if (await isPaused()) return { error: "paused" as const };
    const settings = await getSettings();
    if (!withinWorkingHours(settings, Date.now(), tz())) return { error: "busy" as const };
    const d = pacingDecision(await getPacing(), Date.now(), dayKey(), { maxPerDay: settings.dailyCap });
    if (!d.ok) {
      if (!wait || d.reason !== "interval" || d.waitMs > MAX_WAIT_MS) return { error: "busy" as const };
      await sleep(d.waitMs);
      if (await isPaused()) return { error: "paused" as const };
    }
    const at = Date.now();
    await locked(async () => {
      await setPacing(recordRequest(await getPacing(), at, dayKey(), Math.random()));
      await setLocal(STORAGE_KEYS.history, bumpHistory(await getLocal<History>(STORAGE_KEYS.history, {}), dayKey()));
    });
    const out = await run();
    if (out.error) await locked(async () => setPacing(applyBlockCooldown(await getPacing(), Date.now(), out.error)));
    return out;
  });
}

async function recordOutcome(portal: string, externalId: string | null, reply: ProbeReply): Promise<void> {
  const now = Date.now();
  await locked(async () => {
    const health = recordHealth(await getLocal<HealthMap>(STORAGE_KEYS.health, {}), portal, entryFromReply(reply, now));
    await setLocal(STORAGE_KEYS.health, health);
    const kind = classifyReply(reply);
    const recent = pushRecent(await getLocal<RecentItem[]>(STORAGE_KEYS.recent, []), {
      at: now,
      portal,
      externalId: externalId ? externalId.slice(0, 12) : null,
      kind,
      error: reply.error ? String(reply.error).slice(0, 40) : null,
    });
    await setLocal(STORAGE_KEYS.recent, recent);
    const stats: Stats = { lastAt: now, lastKind: kind, lastError: reply.error ?? null };
    await setLocal(STORAGE_KEYS.stats, stats);
  });
  await refresh();
}

async function probe(job: { portal: string; url: string; externalId: string | null }, wait: boolean): Promise<ProbeReply> {
  const adapter = getHtmlAdapter(job.portal);
  if (!adapter || !adapter.isPortalUrl(job.url)) return { error: "url_not_allowed" };
  if (!portalEnabled(await getSettings(), job.portal)) return { error: "portal_disabled" };
  const reply = await paced(wait, async (): Promise<ProbeReply> => {
    const page = await fetchPage(job.url);
    // Ağ/zaman aşımı ayrıştırıcıdan değil taşıma katmanından gelir: sürüm yok → ayrıştırıcı telemetrisine girmez.
    if ("error" in page) return { error: page.error, classification: "unknown" };
    return adapter.parseListing(page, job.externalId);
  });
  if (reply.error !== "busy" && reply.error !== "paused" && reply.error !== "not_connected") await recordOutcome(job.portal, job.externalId, reply);
  return reply;
}

async function inventory(job: { portal: string; url: string }) {
  const adapter = getHtmlAdapter(job.portal);
  if (!adapter || !adapter.isPortalUrl(job.url)) return { items: [], nextUrl: null, error: "url_not_allowed" };
  if (!portalEnabled(await getSettings(), job.portal)) return { items: [], nextUrl: null, error: "portal_disabled" };
  const r = await paced(true, async () => {
    const page = await fetchPage(job.url);
    if ("error" in page) return { items: [], nextUrl: null, error: page.error };
    return adapter.parseStore(page);
  });
  return "items" in r ? r : { items: [], nextUrl: null, error: r.error };
}

// ---------------------------------------------------------------- ileti işleyici

async function canFetch() {
  if (!(await isConnected())) return { ok: false, waitMs: 60_000, reason: "not_connected" };
  if (await isPaused()) return { ok: false, waitMs: 60_000, reason: "paused" };
  const settings = await getSettings();
  if (!withinWorkingHours(settings, Date.now(), tz())) return { ok: false, waitMs: 60_000, reason: "hours" };
  return pacingDecision(await getPacing(), Date.now(), dayKey(), { maxPerDay: settings.dailyCap });
}

async function handle(msg: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.kind) {
    case "status":
      return refresh();
    case "setPaused":
      await setLocal(STORAGE_KEYS.paused, msg.paused === true);
      return refresh();
    case "setConnected": {
      if (msg.connected === true) {
        let origin = __EMLAKSOFT_APP_ORIGINS__[__EMLAKSOFT_APP_ORIGINS__.length - 1];
        try {
          if (sender.tab?.url) origin = new URL(sender.tab.url).origin;
        } catch {
          /* varsayılan köken */
        }
        await setLocal(STORAGE_KEYS.pairing, { at: Date.now(), origin } satisfies NonNullable<Pairing>);
      } else {
        await chrome.storage.local.remove(STORAGE_KEYS.pairing);
        await chrome.storage.session.remove(STORAGE_KEYS.lease);
      }
      return refresh();
    }
    case "appSeen": {
      const now = Date.now();
      await locked(async () => {
        const prev = await getApp();
        const session: AppSession = msg.session === "unknown" ? prev.session : msg.session;
        await setLocal(STORAGE_KEYS.app, { seenAt: now, session, okAt: msg.session === "ok" ? now : prev.okAt } satisfies AppState);
      });
      return refresh();
    }
    case "saveSettings":
      await setLocal(STORAGE_KEYS.settings, sanitizeSettings(msg.settings));
      return refresh();
    case "lease": {
      const d = leaseDecision(await getLease(), String(msg.token ?? ""), Date.now());
      if (d.granted) await chrome.storage.session.set({ [STORAGE_KEYS.lease]: d.lease });
      return { granted: d.granted };
    }
    case "releaseLease": {
      const next = releaseLease(await getLease(), String(msg.token ?? ""));
      await chrome.storage.session.set({ [STORAGE_KEYS.lease]: next });
      return { ok: true };
    }
    case "deviceKey": {
      let key = await getLocal<string>(STORAGE_KEYS.deviceKey, "");
      if (!key || key.length < 16) {
        key = `ext-${crypto.randomUUID()}`;
        await setLocal(STORAGE_KEYS.deviceKey, key);
      }
      return { deviceKey: key };
    }
    case "canFetch":
      return canFetch();
    case "probe":
      return probe(msg.job, msg.wait === true);
    case "inventory":
      return inventory(msg.job);
    case "outboxPut":
      return locked(async () => {
        const list = await getLocal<OutboxEntry[]>(STORAGE_KEYS.outbox, []);
        const e = msg.entry;
        await setLocal(
          STORAGE_KEYS.outbox,
          enqueue(list, { jobId: String(e.jobId), clientId: String(e.clientId), result: String(e.result), observed: e.observed ?? {}, telemetry: e.telemetry ?? null }, Date.now()),
        );
        return { ok: true };
      });
    case "outboxDue":
      return { entries: dueEntries(await getLocal<OutboxEntry[]>(STORAGE_KEYS.outbox, []), Date.now()).slice(0, 3) };
    case "outboxDone":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.outbox, markDone(await getLocal<OutboxEntry[]>(STORAGE_KEYS.outbox, []), String(msg.jobId)));
        return { ok: true };
      });
    case "outboxFail":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.outbox, markFailed(await getLocal<OutboxEntry[]>(STORAGE_KEYS.outbox, []), String(msg.jobId), Date.now()));
        return { ok: true };
      });
    default:
      return { error: "unknown" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Yalnız bu eklentinin kendi bileşenleri konuşur: açılır pencere ya da izinli EmlakSoft sekmesindeki içerik betiği.
  if (!isTrustedSender(sender, chrome.runtime.id, __EMLAKSOFT_APP_ORIGINS__)) return false;
  if (typeof message !== "object" || message === null || typeof (message as { kind?: unknown }).kind !== "string") return false;
  handle(message as BgRequest, sender).then(sendResponse, () => sendResponse({ error: "internal" }));
  return true;
});

// ---------------------------------------------------------------- MV3 uyandırma (alarm)

/** Dakikada bir: rozet/bayrak tazele (engel beklemesi bitti mi, çalışma saati açıldı mı) ve süresi dolan kuyruk kayıtlarını ayıkla. */
function ensureAlarm() {
  void chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
}
ensureAlarm();
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void refresh();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void refresh();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_TICK) return;
  void locked(async () => {
    const list = await getLocal<OutboxEntry[]>(STORAGE_KEYS.outbox, []);
    const pruned = prune(list, Date.now());
    if (pruned.length !== list.length) await setLocal(STORAGE_KEYS.outbox, pruned);
  }).then(() => refresh());
});
