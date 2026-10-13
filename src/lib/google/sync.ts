import { fetchAdsDaily, type AdsDailyRow } from "./ads";
import { fetchSearchAnalytics, gscFetchRange, type GscRow } from "./gsc";
import { isInvalidGrant, type GoogleDeps } from "./http";
import { GOOGLE_KEYS, type GoogleService } from "./keys";
import { refreshAccessToken } from "./oauth";
import { GOOGLE_QUOTAS, MinuteWindow, QuotaExceededError, dailyWindow, type QuotaWindow } from "./quotas";
import {
  patchToken,
  readGoogleSnapshot,
  readSealed,
  writeSealed,
  type GoogleStoreSnapshot,
  type QuotaRecord,
  type SettingsPort,
} from "./token-store";
import { inspectUrl, readLiveSitemap, selectUrlsToInspect, type InspectionRecord, type InspectionResult, type SitemapEntry } from "./url-inspection";

/**
 * `google-senkron` cron'unun çekirdeği (bağımlılıklar enjekte; testli).
 *  - Bağlantı yoksa (ya da yeniden bağlama bekliyorsa) HİÇBİR dış çağrı yapılmaz: `{ skipped }` döner.
 *  - Bağlıysa: Search Console analitiği → URL Inspection → Ads, sonra budama. Her hizmet ayrı try/catch: birinin hatası
 *    diğerini durdurmaz; hatalar adım/satır başına `steps` içinde döner (heartbeat detayına yazılır).
 *  - `invalid_grant`: hizmet kaydı "yeniden bağla" işaretlenir (toplayıcı kritik bulgu üretir), o hizmette başka çağrı yapılmaz.
 */

export type GoogleDataStore = {
  lastGscDay(): Promise<string | null>;
  lastAdsDay(): Promise<string | null>;
  upsertGscRows(rows: readonly GscRow[]): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  upsertAdsRows(rows: readonly AdsDailyRow[]): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  readInspectionIndex(): Promise<InspectionRecord[]>;
  upsertInspection(r: InspectionResult, checkedAtIso: string): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  prune(): Promise<number>;
};

export type SyncDeps = {
  port: SettingsPort;
  store: GoogleDataStore;
  google?: GoogleDeps;
  nowMs: () => number;
  readSitemap?: () => Promise<SitemapEntry[]>;
};

export type SyncStep = { service: GoogleService | "budama"; step: string; ok: boolean; detail: string };

export type SyncOutcome =
  | { skipped: true; reason: string }
  | { skipped: false; steps: SyncStep[]; failed: number; reconnect: GoogleService[] };

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Hizmet çalışmaya hazır mı (istemci + belirteç + ön koşul, yeniden bağlama beklemiyor). */
export function readyServices(s: GoogleStoreSnapshot): GoogleService[] {
  const out: GoogleService[] = [];
  if (!s.client) return out;
  if (s.tokens.gsc && !s.tokens.gsc.needsReconnect && s.gscProperty) out.push("gsc");
  if (s.tokens.ads && !s.tokens.ads.needsReconnect && s.adsAccount) out.push("ads");
  return out;
}

function errText(e: unknown): string {
  if (e instanceof QuotaExceededError) return "kota eşiği (%80) doldu";
  if (e instanceof Error) return e.message.slice(0, 200);
  return "bilinmeyen hata";
}

async function readQuota(port: SettingsPort, key: string): Promise<QuotaRecord | null> {
  try {
    return await readSealed<QuotaRecord>(port, key);
  } catch {
    return null;
  }
}

export async function runGoogleSync(deps: SyncDeps): Promise<SyncOutcome> {
  const snap = await readGoogleSnapshot(deps.port);
  const ready = readyServices(snap);
  if (ready.length === 0) {
    const waiting = (["gsc", "ads"] as const).some((s) => snap.tokens[s]?.needsReconnect);
    return { skipped: true, reason: waiting ? "yeniden bağlanmayı bekliyor" : "bağlı değil" };
  }
  const client = snap.client!;
  const nowMs = deps.nowMs();
  const today = isoDay(nowMs);
  const steps: SyncStep[] = [];
  const reconnect: GoogleService[] = [];
  const push = (s: SyncStep) => steps.push(s);

  const [qInspection, qAds] = await Promise.all([readQuota(deps.port, GOOGLE_KEYS.quotaInspection), readQuota(deps.port, GOOGLE_KEYS.quotaAds)]);
  const inspectionQuota: QuotaWindow = dailyWindow(GOOGLE_QUOTAS.inspectionPerDay, qInspection, today);
  const adsQuota: QuotaWindow = dailyWindow(GOOGLE_QUOTAS.adsPerDay, qAds, today);
  const gscMinute = new MinuteWindow(GOOGLE_QUOTAS.gscPerMinute, deps.nowMs);

  async function token(service: GoogleService): Promise<string | null> {
    try {
      return await refreshAccessToken({ client, refreshToken: snap.tokens[service]!.refreshToken }, deps.google);
    } catch (e) {
      if (isInvalidGrant(e)) {
        reconnect.push(service);
        await patchToken(deps.port, service, { needsReconnect: true, lastError: "Google erişimi geri çekti (invalid_grant)" }).catch(() => false);
        push({ service, step: "belirteç", ok: false, detail: "invalid_grant: yeniden bağlanmalı" });
      } else {
        push({ service, step: "belirteç", ok: false, detail: errText(e) });
      }
      return null;
    }
  }

  // ---- Search Console ----
  if (ready.includes("gsc")) {
    const access = await token("gsc");
    if (access) {
      const property = snap.gscProperty!.siteUrl;
      let gscOk = true;
      try {
        const range = gscFetchRange(await deps.store.lastGscDay(), nowMs);
        let stored = 0;
        for (const withQuery of [true, false]) {
          const { rows, truncated } = await fetchSearchAnalytics(
            { property, accessToken: access, ...range, withQuery, quota: gscMinute },
            deps.google,
          );
          const res = await deps.store.upsertGscRows(rows);
          if (!res.ok) throw new Error(`kayıt: ${res.error}`);
          stored += res.count;
          if (truncated) push({ service: "gsc", step: "analitik", ok: false, detail: "sayfa üst sınırı: liste kesildi" });
        }
        push({ service: "gsc", step: "analitik", ok: true, detail: `${range.startDate}→${range.endDate}, ${stored} satır` });
      } catch (e) {
        gscOk = false;
        push({ service: "gsc", step: "analitik", ok: false, detail: errText(e) });
      }

      try {
        const [sitemap, index] = await Promise.all([(deps.readSitemap ?? readLiveSitemap)(), deps.store.readInspectionIndex()]);
        const urls = selectUrlsToInspect(sitemap, index, inspectionQuota.remaining());
        let done = 0;
        let rowErrors = 0;
        for (const url of urls) {
          if (!inspectionQuota.tryConsume(1)) break;
          try {
            const r = await inspectUrl({ property, url, accessToken: access }, deps.google);
            const saved = await deps.store.upsertInspection(r, new Date(deps.nowMs()).toISOString());
            if (!saved.ok) throw new Error(saved.error);
            done += 1;
          } catch (e) {
            rowErrors += 1;
            gscOk = false;
            push({ service: "gsc", step: `inceleme ${url}`, ok: false, detail: errText(e) });
          }
        }
        push({ service: "gsc", step: "inceleme", ok: rowErrors === 0, detail: `${done}/${urls.length} URL incelendi` });
      } catch (e) {
        gscOk = false;
        push({ service: "gsc", step: "inceleme", ok: false, detail: errText(e) });
      }
      await patchToken(deps.port, "gsc", {
        lastSyncAt: new Date(deps.nowMs()).toISOString(),
        lastError: gscOk ? null : (steps.find((s) => s.service === "gsc" && !s.ok)?.detail ?? null),
      }).catch(() => false);
    }
  }

  // ---- Google Ads (yalnız okuma) ----
  if (ready.includes("ads")) {
    const access = await token("ads");
    if (access) {
      const acct = snap.adsAccount!;
      let adsOk = true;
      try {
        const last = await deps.store.lastAdsDay();
        const end = nowMs - DAY;
        const backfill = end - 89 * DAY;
        const start = last ? Math.max(backfill, Math.min(end, Date.parse(`${last}T00:00:00Z`) - 2 * DAY)) : backfill;
        const rows = await fetchAdsDaily(
          {
            customerId: acct.customerId,
            loginCustomerId: acct.loginCustomerId,
            developerToken: acct.developerToken,
            apiVersion: acct.apiVersion ?? null,
            accessToken: access,
            startDate: isoDay(start),
            endDate: isoDay(end),
            quota: adsQuota,
          },
          deps.google,
        );
        const res = await deps.store.upsertAdsRows(rows);
        if (!res.ok) throw new Error(`kayıt: ${res.error}`);
        push({ service: "ads", step: "metrikler", ok: true, detail: `${isoDay(start)}→${isoDay(end)}, ${res.count} satır` });
      } catch (e) {
        adsOk = false;
        push({ service: "ads", step: "metrikler", ok: false, detail: errText(e) });
      }
      await patchToken(deps.port, "ads", {
        lastSyncAt: new Date(deps.nowMs()).toISOString(),
        lastError: adsOk ? null : (steps.find((s) => s.service === "ads" && !s.ok)?.detail ?? null),
      }).catch(() => false);
    }
  }

  // Kota sayaçları (yalnız değiştiyse yazılır).
  await Promise.all([
    inspectionQuota.count !== (qInspection?.day === today ? qInspection.used : 0)
      ? writeSealed(deps.port, GOOGLE_KEYS.quotaInspection, { day: today, used: inspectionQuota.count }, null, "kota").catch(() => false)
      : true,
    adsQuota.count !== (qAds?.day === today ? qAds.used : 0)
      ? writeSealed(deps.port, GOOGLE_KEYS.quotaAds, { day: today, used: adsQuota.count }, null, "kota").catch(() => false)
      : true,
  ]);

  try {
    const removed = await deps.store.prune();
    push({ service: "budama", step: "budama", ok: true, detail: `${removed} eski satır silindi` });
  } catch (e) {
    push({ service: "budama", step: "budama", ok: false, detail: errText(e) });
  }

  return { skipped: false, steps, failed: steps.filter((s) => !s.ok).length, reconnect };
}

/** Heartbeat detayı (kısa): hizmet başına özet + hatalı adımlar. */
export function syncSummary(outcome: Extract<SyncOutcome, { skipped: false }>): string {
  const parts = outcome.steps.filter((s) => s.ok || !s.step.startsWith("inceleme ")).map((s) => `${s.service}/${s.step}: ${s.detail}`);
  const rowErrors = outcome.steps.filter((s) => !s.ok && s.step.startsWith("inceleme ")).length;
  if (rowErrors > 0) parts.push(`${rowErrors} URL inceleme hatası`);
  return parts.join(" · ").slice(0, 900);
}
