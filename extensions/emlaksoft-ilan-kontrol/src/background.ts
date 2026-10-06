import { getHtmlAdapter, PORTAL_RULES_VERSION, type FetchedPage } from "@/lib/listing-control/adapters/html";
import { MAX_HTML_CHARS } from "@/lib/listing-control/adapters/html/parse-core";
import {
  applyBlockCooldown,
  INITIAL_PACING,
  leaseDecision,
  localDayKey,
  pacingDecision,
  recordRequest,
  releaseLease,
  todayCount,
  type Lease,
  type PacingState,
} from "@/lib/listing-control/worker/extension-pacing";
import type { ProbeReply } from "@/lib/listing-control/worker/core";
import { STORAGE_KEYS, type BgRequest, type StatusReply } from "./messages";

/**
 * SERVICE WORKER: bütün portal isteklerinin TEK geçidi. Yalnız manifest'teki portal alanlarına, kullanıcının kendi
 * tarayıcı oturumuyla (`credentials: "include"`), yeni sekme AÇMADAN istek atar; sayfayı saf ayrıştırıcıyla
 * (`src/lib/listing-control/adapters/html`) okur. Hız kuralı ve lider kirası `extension-pacing.ts`'ten gelir.
 * YASAK (yapılmaz): CAPTCHA çözme/atlatma, kullanıcı ajanı taklidi, IP/çerez oyunu, hız sınırını aşma, giriş bilgisi
 * isteme. Engel görülünce 30 dk durulur ve sonuç "kontrol edilemedi" olarak bildirilir.
 */

const FETCH_TIMEOUT_MS = 20_000;
/** Sayfa içi işçiden gelen istekte beklenmez (zaman aşımı 25 sn); otomatik döngü ve liste okumada kısa bekleme kabul. */
const MAX_WAIT_MS = 35_000;

type Stats = { lastAt: number | null; lastOutcome: StatusReply["lastOutcome"]; lastError: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayKey = () => localDayKey(Date.now(), new Date().getTimezoneOffset());

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const v = (await chrome.storage.local.get(key))[key];
  return (v as T | undefined) ?? fallback;
}

async function isPaused(): Promise<boolean> {
  return (await getLocal<boolean>(STORAGE_KEYS.paused, false)) === true;
}

async function getPacing(): Promise<PacingState> {
  return { ...INITIAL_PACING, ...(await getLocal<Partial<PacingState>>(STORAGE_KEYS.pacing, {})) };
}

async function setPacing(s: PacingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.pacing]: s });
}

async function getLease(): Promise<Lease> {
  const v = (await chrome.storage.session.get(STORAGE_KEYS.lease))[STORAGE_KEYS.lease];
  return (v as Lease | undefined) ?? null;
}

async function recordStats(reply: { error?: string | null; found?: boolean | null }): Promise<void> {
  const outcome: Stats["lastOutcome"] = reply.error
    ? /^(http_429|http_40[13]|captcha|login_required|timeout|http_5\d\d)$/.test(reply.error)
      ? "blocked"
      : "error"
    : reply.found === true
      ? "found"
      : reply.found === false
        ? "not_found"
        : "error";
  const stats: Stats = { lastAt: Date.now(), lastOutcome: outcome, lastError: reply.error ?? null };
  await chrome.storage.local.set({ [STORAGE_KEYS.stats]: stats });
}

// Tek service worker örneği içinde portal istekleri SIRAYLA gider (eşzamanlı istek yok).
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

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

/** Hız kuralıyla tek portal isteği. Beklenemiyorsa `busy`, duraklatılmışsa `paused` (gözlem DEĞİL; iş geri bırakılır). */
async function paced<T extends { error?: string | null }>(wait: boolean, run: () => Promise<T>): Promise<T | { error: "busy" | "paused" }> {
  return serialize(async () => {
    if (await isPaused()) return { error: "paused" as const };
    const d = pacingDecision(await getPacing(), Date.now(), dayKey());
    if (!d.ok) {
      if (!wait || d.reason !== "interval" || d.waitMs > MAX_WAIT_MS) return { error: "busy" as const };
      await sleep(d.waitMs);
      if (await isPaused()) return { error: "paused" as const };
    }
    await setPacing(recordRequest(await getPacing(), Date.now(), dayKey(), Math.random()));
    const out = await run();
    if (out.error) await setPacing(applyBlockCooldown(await getPacing(), Date.now(), out.error));
    return out;
  });
}

async function probe(job: { portal: string; url: string; externalId: string | null }, wait: boolean): Promise<ProbeReply> {
  const adapter = getHtmlAdapter(job.portal);
  if (!adapter || !adapter.isPortalUrl(job.url)) return { error: "url_not_allowed" };
  const reply = await paced(wait, async (): Promise<ProbeReply> => {
    const page = await fetchPage(job.url);
    if ("error" in page) return { error: page.error };
    return adapter.parseListing(page, job.externalId);
  });
  if (reply.error !== "busy" && reply.error !== "paused") await recordStats(reply);
  return reply;
}

async function inventory(job: { portal: string; url: string }) {
  const adapter = getHtmlAdapter(job.portal);
  if (!adapter || !adapter.isPortalUrl(job.url)) return { items: [], nextUrl: null, error: "url_not_allowed" };
  const r = await paced(true, async () => {
    const page = await fetchPage(job.url);
    if ("error" in page) return { items: [], nextUrl: null, error: page.error };
    return adapter.parseStore(page);
  });
  return "items" in r ? r : { items: [], nextUrl: null, error: r.error };
}

async function status(): Promise<StatusReply> {
  const [paused, pacing, stats, lease] = await Promise.all([
    isPaused(),
    getPacing(),
    getLocal<Stats>(STORAGE_KEYS.stats, { lastAt: null, lastOutcome: null, lastError: null }),
    getLease(),
  ]);
  return {
    paused,
    today: todayCount(pacing, dayKey()),
    lastAt: stats.lastAt,
    lastOutcome: stats.lastOutcome,
    lastError: stats.lastError,
    cooldownUntil: pacing.cooldownUntilMs,
    leaderActive: !!lease && lease.expiresAtMs > Date.now(),
    version: chrome.runtime.getManifest().version,
    rulesVersion: PORTAL_RULES_VERSION,
  };
}

async function handle(msg: BgRequest): Promise<unknown> {
  switch (msg.kind) {
    case "status":
      return status();
    case "setPaused":
      await chrome.storage.local.set({ [STORAGE_KEYS.paused]: msg.paused === true });
      return status();
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
        await chrome.storage.local.set({ [STORAGE_KEYS.deviceKey]: key });
      }
      return { deviceKey: key };
    }
    case "canFetch": {
      if (await isPaused()) return { ok: false, waitMs: 60_000, reason: "paused" };
      return pacingDecision(await getPacing(), Date.now(), dayKey());
    }
    case "probe":
      return probe(msg.job, msg.wait === true);
    case "inventory":
      return inventory(msg.job);
    default:
      return { error: "unknown" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Yalnız bu eklentinin kendi bileşenleri (içerik betiği / açılır pencere) konuşabilir.
  if (sender.id !== chrome.runtime.id) return false;
  if (typeof message !== "object" || message === null || typeof (message as { kind?: unknown }).kind !== "string") return false;
  handle(message as BgRequest).then(sendResponse, () => sendResponse({ error: "internal" }));
  return true;
});
