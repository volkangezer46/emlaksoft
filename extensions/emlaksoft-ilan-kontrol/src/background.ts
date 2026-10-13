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
import {
  applyPage,
  buildUpload,
  dueUploads,
  duePortals,
  enqueueUpload,
  markUploadDone,
  markUploadFailed,
  nextPortalState,
  startScan,
  type ScanOutcome,
  type ScanProgress,
  type ScanStates,
  type ScanUpload,
} from "@/lib/listing-control/worker/extension-scan";
import { dueFsbo, enqueueFsbo, markFsboDone, markFsboFailed, sanitizeFsboPayload, type FsboPending } from "@/lib/prospecting/extension-queue";
import { isAllowedAppOrigin } from "@/lib/listing-control/worker/extension-pairing";
import {
  doneEntry,
  doneKey,
  dueEntries as dueQueue,
  enqueueEntry,
  failEntry,
  importKey,
  sanitizeDonePayload,
  sanitizeImportPayload,
  sanitizeTransferResponse,
  type DonePayload,
  type ImportPayload,
  type QueueEntry,
  type StoredTransfer,
} from "@/lib/portal-transfer/ext-queue";
import { QUEUE_MAX_ATTEMPTS, QUEUE_TTL_MS } from "@/lib/portal-transfer/ext-queue";
import { EMPTY_RULES_META, applyRulesResponse, effectiveRulesEtag, nextRulesEtag, rulesEtagScope, type RulesMeta, type StoredRulesMap } from "@/lib/portal-transfer/rules-store";
import { FEEDBACK_CONSENT_TEXT_VERSION, feedbackKey, sanitizeFeedbackPayload, type FeedbackPayload } from "@/lib/portal-transfer/feedback-format";
import { sanitizeSnapshot } from "@/lib/portal-transfer/correction";
import { installLandingUrl, shouldOpenInstallLanding } from "@/lib/listing-control/worker/extension-install";
import { ALARM_SCAN, ALARM_TICK, STORAGE_KEYS, type BgRequest, type ExternalRequest, type FeedbackConsent } from "./messages";

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
/** Aktarım paketi bu süre sonra düşer (kod 2 saatlik; doldurma/yayın için pay). Fotoğraf başına en çok ~1,1 MB (base64) kabul edilir. */
const TRANSFER_TTL_MS = 12 * 3_600_000;
const TRANSFER_PHOTO_MAX_B64 = 1_500_000;

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

/** Oturum deposundaki aktarım fotoğraflarını temizler (en çok 40 sıra). */
async function clearTransferPhotos(): Promise<void> {
  await chrome.storage.session.remove(Array.from({ length: 40 }, (_, i) => `${STORAGE_KEYS.transferPhotoPrefix}${i}`));
}

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
  const [paused, pacing, pairing, app, settings, health, history, recent, stats, outbox, lease, scanStates, scanProgress, scanUploads] = await Promise.all([
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
    getLocal<ScanStates>(STORAGE_KEYS.scanStates, {}),
    getLocal<ScanProgress | null>(STORAGE_KEYS.scan, null),
    getLocal<ScanUpload[]>(STORAGE_KEYS.scanUploads, []),
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
    scan: { states: scanStates, progress: scanProgress, pendingUploads: scanUploads.length },
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

// ---------------------------------------------------------------- günlük mağaza taraması

const DEFER_ERRORS = new Set(["busy", "paused", "not_connected", "portal_disabled"]);
const TRANSPORT_ERRORS = new Set(["timeout", "network_error"]);
let scanning = false;

/** Uzun taramada service worker'ı uyanık tutar (her çağrı boşta sayacını sıfırlar). */
function keepAlive(): () => void {
  const t = setInterval(() => void chrome.runtime.getPlatformInfo().catch(() => undefined), 20_000);
  return () => clearInterval(t);
}

async function finishScan(outcome: ScanOutcome): Promise<void> {
  const now = Date.now();
  await locked(async () => {
    const states = await getLocal<ScanStates>(STORAGE_KEYS.scanStates, {});
    states[outcome.portal] = nextPortalState(states[outcome.portal], outcome, now);
    await setLocal(STORAGE_KEYS.scanStates, states);
    // Engelde ya da hiç ilan okunmadan ağ hatasında yükleme yok; okunamayan yapı ("ayrıştırılamadı") telemetri için yüklenir.
    if (outcome.kind !== "blocked" && !(outcome.read === 0 && outcome.reason !== null && TRANSPORT_ERRORS.has(outcome.reason))) {
      const list = await getLocal<ScanUpload[]>(STORAGE_KEYS.scanUploads, []);
      await setLocal(STORAGE_KEYS.scanUploads, enqueueUpload(list, buildUpload(outcome, PARSER_VERSION, now), now));
    }
    await chrome.storage.local.remove(STORAGE_KEYS.scan);
  });
}

/**
 * Ofisin kendi "ilanlarım" listesini sayfa sayfa okur (aynı hız kuralı: `paced`). Süren tarama `chrome.storage`'da saklanır;
 * service worker kapanırsa ya da hız sınırına takılırsa dakikalık alarm KALDIĞI YERDEN sürdürür. Bağlı değilken, duraklatılmışken
 * ya da çalışma saati dışında hiçbir şey yapılmaz (paced bunları zaten uygular).
 */
async function runScanCycle(force = false): Promise<void> {
  if (scanning) return;
  scanning = true;
  const stop = keepAlive();
  try {
    for (let guard = 0; guard < PORTAL_IDS.length + 1; guard += 1) {
      if (!(await isConnected()) || (await isPaused())) return;
      const settings = await getSettings();
      let progress = await getLocal<ScanProgress | null>(STORAGE_KEYS.scan, null);
      // Kapatılan portalın ya da 6 saatten eski yarım taramanın ilerlemesi atılır (takılı kalmasın).
      if (progress && (!portalEnabled(settings, progress.portal) || Date.now() - progress.startedAt > 6 * 3_600_000)) {
        await chrome.storage.local.remove(STORAGE_KEYS.scan);
        progress = null;
      }
      if (!progress) {
        const states = await getLocal<ScanStates>(STORAGE_KEYS.scanStates, {});
        const enabled = (id: string) => portalEnabled(settings, id);
        const due = force ? PORTAL_IDS.filter(enabled) : duePortals(states, PORTAL_IDS, enabled, Date.now());
        const id = due.find((p) => (getHtmlAdapter(p)?.storeStartUrls.length ?? 0) > 0);
        if (!id) return;
        progress = startScan(id, getHtmlAdapter(id)!.storeStartUrls[0], Date.now());
        await setLocal(STORAGE_KEYS.scan, progress);
      }
      while (progress) {
        const page = await inventory({ portal: progress.portal, url: progress.nextUrl });
        if (page.error && DEFER_ERRORS.has(page.error)) return; // sonraki uyanışta sürer
        if (page.error && TRANSPORT_ERRORS.has(page.error)) {
          await finishScan({
            portal: progress.portal,
            startedAt: progress.startedAt,
            kind: "partial",
            complete: false,
            expected: progress.totalCount,
            read: progress.items.length,
            pages: progress.pages,
            items: progress.items,
            reason: page.error,
          });
          progress = null;
          break;
        }
        const step = applyPage(progress, { items: page.items, nextUrl: page.nextUrl, error: page.error, totalCount: "totalCount" in page ? page.totalCount : null });
        if (step.kind === "continue") {
          progress = step.progress;
          await setLocal(STORAGE_KEYS.scan, progress);
        } else {
          await finishScan(step.outcome);
          progress = null;
        }
        await refresh();
      }
    }
  } finally {
    scanning = false;
    stop();
    await refresh();
  }
}

// ---------------------------------------------------------------- (0.6.0) kurallar, geri bildirim kuyruğu, rıza

/** Geri bildirim kuyruğu (genel ext-queue kayıt biçimi; sınır 40 kayıt, 8 deneme, 24 saat). */
const FEEDBACK_QUEUE_MAX = 40;
type FeedbackEntry = QueueEntry<FeedbackPayload>;

function pruneFeedback(list: readonly FeedbackEntry[], nowMs: number): FeedbackEntry[] {
  return list.filter((e) => nowMs - e.queuedAt < QUEUE_TTL_MS && e.attempts < QUEUE_MAX_ATTEMPTS).slice(-FEEDBACK_QUEUE_MAX);
}

async function getRulesMeta(): Promise<RulesMeta> {
  return { ...EMPTY_RULES_META, ...(await getLocal<Partial<RulesMeta>>(STORAGE_KEYS.formRulesMeta, {})) };
}

/** Geçerli rıza: açıkça verilmiş VE bugünkü metin sürümüne. Yoksa geri bildirim hiç üretilmez/gönderilmez. */
async function hasConsent(): Promise<boolean> {
  const c = await getLocal<FeedbackConsent | null>(STORAGE_KEYS.feedbackConsent, null);
  return c?.granted === true && c.textVersion === FEEDBACK_CONSENT_TEXT_VERSION;
}

/** Rıza geri alındı ya da yok: bekleyen geri bildirim ve anlık görüntü SİLİNİR (24 saat beklemeden). */
async function dropFeedbackData(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.feedback);
  await chrome.storage.session.remove(STORAGE_KEYS.fillSnapshot);
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
        void runScanCycle(); // bağlanır bağlanmaz ilk tarama (3. adım: gerisi otomatik)
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
    case "scanNow":
      void runScanCycle(true); // uzun sürer: yanıt beklenmez, durum görünümü ilerlemeyi gösterir
      return refresh();
    case "scanPendingDue": {
      const list = await getLocal<ScanUpload[]>(STORAGE_KEYS.scanUploads, []);
      return { entries: dueUploads(list, Date.now()).slice(0, 1) };
    }
    case "scanPendingDone":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.scanUploads, markUploadDone(await getLocal<ScanUpload[]>(STORAGE_KEYS.scanUploads, []), String(msg.id)));
        return { ok: true };
      });
    case "scanPendingFail":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.scanUploads, markUploadFailed(await getLocal<ScanUpload[]>(STORAGE_KEYS.scanUploads, []), String(msg.id), Date.now()));
        return { ok: true };
      });
    case "fsboPut":
      return locked(async () => {
        // Kullanıcının popup'ta onayladığı TEK ilan (okuma popup'ta, tıklamayla yapıldı); arka planda hiçbir sayfa okunmaz.
        const payload = sanitizeFsboPayload(msg.payload);
        if (!payload) return { ok: false, error: "invalid" };
        const list = await getLocal<FsboPending[]>(STORAGE_KEYS.fsboPending, []);
        await setLocal(STORAGE_KEYS.fsboPending, enqueueFsbo(list, payload, Date.now(), crypto.randomUUID()));
        return { ok: true };
      });
    case "fsboPendingDue": {
      const list = await getLocal<FsboPending[]>(STORAGE_KEYS.fsboPending, []);
      return { entries: dueFsbo(list, Date.now()).slice(0, 3) };
    }
    case "fsboPendingDone":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.fsboPending, markFsboDone(await getLocal<FsboPending[]>(STORAGE_KEYS.fsboPending, []), String(msg.id)));
        await setLocal(STORAGE_KEYS.fsboLast, { at: Date.now(), summary: String(msg.summary ?? "").slice(0, 200), ok: true });
        return { ok: true };
      });
    case "fsboPendingFail":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.fsboPending, markFsboFailed(await getLocal<FsboPending[]>(STORAGE_KEYS.fsboPending, []), String(msg.id), Date.now()));
        return { ok: true };
      });
    case "fsboLast":
      return { last: await getLocal<{ at: number; summary: string; ok: boolean } | null>(STORAGE_KEYS.fsboLast, null), pending: (await getLocal<FsboPending[]>(STORAGE_KEYS.fsboPending, [])).length };
    // ---- (0.5.0) Portala aktar: paket + fotoğraflar (bellekte), yayın sonrası geri bağlama kuyruğu, portaldan içe alma kuyruğu ----
    case "transferPut":
      return locked(async () => {
        const t = sanitizeTransferResponse(msg.data, Date.now());
        if (!t) return { ok: false, error: "invalid" };
        await clearTransferPhotos();
        await setLocal(STORAGE_KEYS.transfer, t);
        return { ok: true };
      });
    case "transferPhoto":
      return locked(async () => {
        const t = await getLocal<StoredTransfer | null>(STORAGE_KEYS.transfer, null);
        const b64 = typeof msg.b64 === "string" ? msg.b64 : "";
        if (!t || t.sessionId !== msg.sessionId || !Number.isInteger(msg.index) || msg.index < 0 || msg.index >= t.photoIds.length || b64.length === 0 || b64.length > TRANSFER_PHOTO_MAX_B64) {
          return { ok: false };
        }
        await chrome.storage.session.set({ [`${STORAGE_KEYS.transferPhotoPrefix}${msg.index}`]: { name: String(msg.name ?? "foto.jpg").slice(0, 120), type: String(msg.type ?? "image/jpeg").slice(0, 40), b64 } });
        await setLocal(STORAGE_KEYS.transfer, { ...t, photosStored: t.photosStored + 1 } satisfies StoredTransfer);
        return { ok: true };
      });
    case "transferPhotosDone":
      return locked(async () => {
        const t = await getLocal<StoredTransfer | null>(STORAGE_KEYS.transfer, null);
        if (!t || t.sessionId !== msg.sessionId) return { ok: false };
        await setLocal(STORAGE_KEYS.transfer, { ...t, photosDone: true, photosSkipped: Math.max(0, Math.min(40, Math.trunc(Number(msg.skipped) || 0))) } satisfies StoredTransfer);
        return { ok: true };
      });
    case "transferGet": {
      const t = await getLocal<StoredTransfer | null>(STORAGE_KEYS.transfer, null);
      const fresh = t && Date.now() - t.receivedAt < TRANSFER_TTL_MS ? t : null;
      return {
        transfer: fresh,
        doneLast: await getLocal<{ at: number; ok: boolean; summary: string } | null>(STORAGE_KEYS.transferDoneLast, null),
        donePending: (await getLocal<QueueEntry<DonePayload>[]>(STORAGE_KEYS.transferDone, [])).length,
      };
    }
    case "transferPhotos": {
      const from = Math.max(0, Math.trunc(Number(msg.from) || 0));
      const count = Math.max(1, Math.min(4, Math.trunc(Number(msg.count) || 1)));
      const keys = Array.from({ length: count }, (_, i) => `${STORAGE_KEYS.transferPhotoPrefix}${from + i}`);
      const got = await chrome.storage.session.get(keys);
      return { photos: keys.map((k) => got[k] ?? null) };
    }
    case "transferClear":
      return locked(async () => {
        await clearTransferPhotos();
        await chrome.storage.local.remove(STORAGE_KEYS.transfer);
        return { ok: true };
      });
    case "transferDonePut":
      return locked(async () => {
        const payload = sanitizeDonePayload(msg.payload);
        if (!payload) return { ok: false, error: "invalid" };
        const list = await getLocal<QueueEntry<DonePayload>[]>(STORAGE_KEYS.transferDone, []);
        await setLocal(STORAGE_KEYS.transferDone, enqueueEntry(list, doneKey(payload), payload, Date.now(), crypto.randomUUID()));
        return { ok: true };
      });
    case "transferDoneDue":
      return { entries: dueQueue(await getLocal<QueueEntry<DonePayload>[]>(STORAGE_KEYS.transferDone, []), Date.now()).slice(0, 3) };
    case "transferDoneAck":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.transferDone, doneEntry(await getLocal<QueueEntry<DonePayload>[]>(STORAGE_KEYS.transferDone, []), String(msg.id)));
        await setLocal(STORAGE_KEYS.transferDoneLast, { at: Date.now(), ok: msg.ok === true, summary: String(msg.summary ?? "").slice(0, 240) });
        return { ok: true };
      });
    case "transferDoneFail":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.transferDone, failEntry(await getLocal<QueueEntry<DonePayload>[]>(STORAGE_KEYS.transferDone, []), String(msg.id), Date.now()));
        return { ok: true };
      });
    case "importPut":
      return locked(async () => {
        const payload = sanitizeImportPayload(msg.payload);
        if (!payload) return { ok: false, error: "invalid" };
        const list = await getLocal<QueueEntry<ImportPayload>[]>(STORAGE_KEYS.importPending, []);
        await setLocal(STORAGE_KEYS.importPending, enqueueEntry(list, importKey(payload), payload, Date.now(), crypto.randomUUID()));
        return { ok: true, count: payload.items.length };
      });
    case "importDue":
      return { entries: dueQueue(await getLocal<QueueEntry<ImportPayload>[]>(STORAGE_KEYS.importPending, []), Date.now()).slice(0, 1) };
    case "importAck":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.importPending, doneEntry(await getLocal<QueueEntry<ImportPayload>[]>(STORAGE_KEYS.importPending, []), String(msg.id)));
        await setLocal(STORAGE_KEYS.importLast, { at: Date.now(), ok: msg.ok === true, summary: String(msg.summary ?? "").slice(0, 300) });
        return { ok: true };
      });
    case "importFail":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.importPending, failEntry(await getLocal<QueueEntry<ImportPayload>[]>(STORAGE_KEYS.importPending, []), String(msg.id), Date.now()));
        return { ok: true };
      });
    case "importLast":
      return {
        last: await getLocal<{ at: number; ok: boolean; summary: string } | null>(STORAGE_KEYS.importLast, null),
        pending: (await getLocal<QueueEntry<ImportPayload>[]>(STORAGE_KEYS.importPending, [])).length,
      };
    // ---- (0.6.0) Öğrenen kurallar: yalnız imzası doğrulanan, daha yeni sürüm İLERİ yazılır; ret/hata eski seti korur ----
    case "rulesPut":
      return locked(async () => {
        const now = Date.now();
        const meta = await getRulesMeta();
        const r = await applyRulesResponse(await getLocal<StoredRulesMap>(STORAGE_KEYS.formRules, {}), typeof msg.raw === "string" ? msg.raw : "", {
          installedVersion: chrome.runtime.getManifest().version,
          nowMs: now,
        });
        if ("error" in r) {
          await setLocal(STORAGE_KEYS.formRulesMeta, { ...meta, fetchedAt: now, lastError: r.error, failures: meta.failures + 1, rejects: meta.rejects + 1, lastRejectReason: r.error } satisfies RulesMeta);
          return { ok: false, error: r.error };
        }
        if (r.accepted.length > 0) await setLocal(STORAGE_KEYS.formRules, r.stored);
        const last = r.rejected[r.rejected.length - 1];
        await setLocal(STORAGE_KEYS.formRulesMeta, {
          ...meta,
          // Ret varsa ETag saklanmaz (eklenti güncellenince aynı içerik yeniden indirilip denenebilsin).
          etag: nextRulesEtag(r, msg.etag),
          etagScope: rulesEtagScope(chrome.runtime.getManifest().version),
          fetchedAt: now,
          lastError: null,
          failures: 0,
          rejects: meta.rejects + r.rejected.length,
          lastRejectReason: last ? `${last.portal ?? "?"}:${last.reason}` : meta.lastRejectReason,
          lastRejectVersion: last ? last.version : meta.lastRejectVersion,
        } satisfies RulesMeta);
        return { ok: true, accepted: r.accepted, rejected: r.rejected.length };
      });
    case "rulesMeta":
      return locked(async () => {
        const meta = await getRulesMeta();
        const now = Date.now();
        const next: RulesMeta = msg.notModified
          ? { ...meta, fetchedAt: now, lastError: null, failures: 0 }
          : { ...meta, fetchedAt: now, lastError: String(msg.error ?? "error").slice(0, 60), failures: meta.failures + 1 };
        await setLocal(STORAGE_KEYS.formRulesMeta, next);
        return { ok: true };
      });
    case "rulesGet": {
      const stored = await getLocal<StoredRulesMap>(STORAGE_KEYS.formRules, {});
      const portal = String(msg.portal ?? "");
      return { entry: Object.prototype.hasOwnProperty.call(stored, portal) ? (stored[portal] ?? null) : null };
    }
    case "rulesStatus": {
      const stored = await getLocal<StoredRulesMap>(STORAGE_KEYS.formRules, {});
      const versions: Record<string, number> = {};
      for (const [p, e] of Object.entries(stored)) if (e) versions[p] = e.version;
      const meta = await getRulesMeta();
      return { meta: { ...meta, etag: effectiveRulesEtag(meta, rulesEtagScope(chrome.runtime.getManifest().version)) }, versions };
    }
    case "feedbackPut":
      return locked(async () => {
        // Yalnız açılır pencere (kullanıcı tıklaması) ve yalnız rıza varken; yük ortak süzgeçten yeniden geçer.
        if (sender.tab) return { ok: false, error: "forbidden" };
        if (!(await hasConsent())) return { ok: false, error: "no_consent" };
        const clean = sanitizeFeedbackPayload(msg.payload);
        if (!clean.payload) return { ok: false, error: "invalid" };
        const now = Date.now();
        const list = (await getLocal<FeedbackEntry[]>(STORAGE_KEYS.feedback, [])).filter((e) => e.key !== feedbackKey(clean.payload!));
        const entry: FeedbackEntry = { id: crypto.randomUUID(), key: feedbackKey(clean.payload), payload: clean.payload, attempts: 0, nextAttemptAt: now, queuedAt: now };
        await setLocal(STORAGE_KEYS.feedback, pruneFeedback([...list, entry], now));
        return { ok: true };
      });
    case "feedbackDue": {
      if (!(await hasConsent())) {
        await locked(dropFeedbackData);
        return { entries: [] };
      }
      const now = Date.now();
      return { entries: pruneFeedback(await getLocal<FeedbackEntry[]>(STORAGE_KEYS.feedback, []), now).filter((e) => e.nextAttemptAt <= now).slice(0, 3) };
    }
    case "feedbackAck":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.feedback, doneEntry(await getLocal<FeedbackEntry[]>(STORAGE_KEYS.feedback, []), String(msg.id)));
        return { ok: true };
      });
    case "feedbackFail":
      return locked(async () => {
        await setLocal(STORAGE_KEYS.feedback, failEntry(await getLocal<FeedbackEntry[]>(STORAGE_KEYS.feedback, []), String(msg.id), Date.now()));
        return { ok: true };
      });
    case "snapshotPut": {
      if (sender.tab) return { ok: false, error: "forbidden" };
      if (msg.snapshot === null) {
        await chrome.storage.session.remove(STORAGE_KEYS.fillSnapshot); // bağlama sonrası silinir
        return { ok: true };
      }
      const snap = sanitizeSnapshot(msg.snapshot);
      if (!snap) return { ok: false, error: "invalid" };
      await chrome.storage.session.set({ [STORAGE_KEYS.fillSnapshot]: snap });
      return { ok: true };
    }
    case "snapshotGet": {
      if (sender.tab) return { snapshot: null };
      const v = (await chrome.storage.session.get(STORAGE_KEYS.fillSnapshot))[STORAGE_KEYS.fillSnapshot];
      return { snapshot: sanitizeSnapshot(v) };
    }
    case "consentGet":
      return { consent: await getLocal<FeedbackConsent | null>(STORAGE_KEYS.feedbackConsent, null), textVersion: FEEDBACK_CONSENT_TEXT_VERSION };
    case "consentSet":
      return locked(async () => {
        if (sender.tab) return { ok: false, error: "forbidden" };
        const consent: FeedbackConsent = { granted: msg.granted === true, at: Date.now(), textVersion: FEEDBACK_CONSENT_TEXT_VERSION };
        await setLocal(STORAGE_KEYS.feedbackConsent, consent);
        if (!consent.granted) await dropFeedbackData();
        return { ok: true, consent };
      });
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
  // Günlük tarama: saatte bir uyanır; ilk uyanış 1 dk sonra (tarayıcı açıldığında kaçırılan gün telafi edilir).
  void chrome.alarms.create(ALARM_SCAN, { periodInMinutes: 60, delayInMinutes: 1 });
}
ensureAlarm();
chrome.runtime.onInstalled.addListener((details) => {
  ensureAlarm();
  void refresh();
  // İlk kurulumda EmlakSoft'u "Bağla" onayı için aç (yalnız izinli EmlakSoft kökeni; bağlama yine kullanıcı tıklamasıyla olur).
  if (!shouldOpenInstallLanding(details.reason)) return;
  const landing = installLandingUrl(__EMLAKSOFT_APP_ORIGINS__);
  if (landing) void chrome.tabs.create({ url: landing });
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void refresh().then(() => runScanCycle());
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_SCAN) {
    void runScanCycle();
    return;
  }
  if (alarm.name !== ALARM_TICK) return;
  void locked(async () => {
    const list = await getLocal<OutboxEntry[]>(STORAGE_KEYS.outbox, []);
    const pruned = prune(list, Date.now());
    if (pruned.length !== list.length) await setLocal(STORAGE_KEYS.outbox, pruned);
  })
    .then(() => refresh())
    // Yarım kalan tarama (service worker kapandı ya da hız sınırı bekledi) dakikalık uyanışta sürdürülür.
    .then(() => getLocal<ScanProgress | null>(STORAGE_KEYS.scan, null))
    .then((p) => (p ? runScanCycle() : undefined));
});

// ---------------------------------------------------------------- site tarafından algılama (externally_connectable)

/**
 * Yalnız manifest'te izinli EmlakSoft kökenleri bu kanalı kullanabilir (Chrome + ayrıca burada köken denetimi). Tek ileti:
 * `ping` → kurulu mu, sürüm, bağlı mı, duraklatıldı mı. BAĞLAMA, ayar, veri okuma ve portal isteği bu kanaldan YAPILMAZ:
 * bağlama yalnız içerik betiğinin kullanıcı etkinliği doğrulayan köprüsünden (tek tık) gider.
 */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedAppOrigin(sender.origin ?? null, __EMLAKSOFT_APP_ORIGINS__)) return false;
  const m = message as Partial<ExternalRequest> | null;
  if (!m || typeof m !== "object" || m.kind !== "ping") return false;
  void Promise.all([isConnected(), isPaused()]).then(
    ([connected, paused]) => sendResponse({ ok: true, version: chrome.runtime.getManifest().version, connected, paused }),
    () => sendResponse({ ok: false }),
  );
  return true;
});
