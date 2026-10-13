import { createAdminClient } from "@/lib/supabase/admin";
import { now, trDayKey } from "@/lib/clock";
import type { Channel } from "./channel";
import type { Metric } from "./vitals";

/**
 * Ölçüm tamponu (SUNUCU, süreç içi). `logNotFound` deseni: beacon başına DB yazısı YOK; sayaçlar bellekte toplanır,
 * en çok 15 sn'de bir TEK RPC (`analytics_ingest`) ile toplu yazılır. Ek olarak:
 *  - `setInterval(flush, 15 sn).unref()` (trafik dursa da bekleyen sayaç yazılır; süreci ayakta tutmaz),
 *  - SIGTERM'de son boşaltma (yeni sürüm yayınında sayaç kaybolmaz),
 *  - `MAX_PENDING`: bekleyen anahtar tavanı (DB uzun süre yoksa bellek büyümez; aşan sayılır ve atılır),
 *  - günlük ayrık anahtar tavanı 2.000: aşan yeni anahtarlar `(taşma)` kovasına yazılır (kardinalite patlamaz),
 *  - tablo/RPC yoksa (migration uygulanmamış) yazma 10 dk durur, sonra yeniden denenir (F4). Site hiç etkilenmez.
 */

export const FLUSH_INTERVAL_MS = 15_000;
export const MISSING_RETRY_MS = 10 * 60_000;
export const MAX_PENDING = 5_000;
export const DAILY_KEY_CAP = 2_000;
export const OVERFLOW_PATH = "(taşma)";

export type Device = "mobile" | "desktop";
export type PageviewDims = { path_tpl: string; channel: Channel; source: string; medium: string; campaign: string; device: Device };
export type VitalDims = { path_tpl: string; device: Device; metric: Metric; bucket: number; static: boolean };

type DaySeen = { day: string; keys: Set<string> };

const S = {
  pv: new Map<string, number>(),
  wv: new Map<string, number>(),
  seenPv: { day: "", keys: new Set<string>() } as DaySeen,
  seenWv: { day: "", keys: new Set<string>() } as DaySeen,
  missingUntil: 0,
  lastFlushAt: 0,
  lastAcceptedAt: 0,
  lastError: null as { at: number; message: string } | null,
  failures: 0,
  dropped: 0,
  overflowed: 0,
  flushing: null as Promise<FlushResult> | null,
  timer: null as ReturnType<typeof setInterval> | null,
  shutdownHooked: false,
};

const SEP = "\u0001";

function pvKey(day: string, d: PageviewDims): string {
  return [day, d.path_tpl, d.channel, d.source, d.medium, d.campaign, d.device].join(SEP);
}
function wvKey(day: string, d: VitalDims): string {
  return [day, d.path_tpl, d.device, d.metric, String(d.bucket), d.static ? "1" : "0"].join(SEP);
}

/** Günlük ayrık anahtar tavanı: yeni anahtar tavanı aşıyorsa false (çağıran taşma kovasına yazar). */
function admit(seen: DaySeen, day: string, key: string): boolean {
  if (seen.day !== day) {
    seen.day = day;
    seen.keys.clear();
  }
  if (seen.keys.has(key)) return true;
  if (seen.keys.size >= DAILY_KEY_CAP) return false;
  seen.keys.add(key);
  return true;
}

function bump(map: Map<string, number>, key: string, inc = 1): void {
  const cur = map.get(key);
  if (cur !== undefined) map.set(key, cur + inc);
  else if (map.size < MAX_PENDING) map.set(key, inc);
  else S.dropped += inc;
}

export function recordPageview(dims: PageviewDims, nowMs: number = now()): void {
  if (nowMs < S.missingUntil) return;
  ensureStarted();
  const day = trDayKey(nowMs);
  let key = pvKey(day, dims);
  if (!admit(S.seenPv, day, key)) {
    S.overflowed += 1;
    key = pvKey(day, { path_tpl: OVERFLOW_PATH, channel: "unknown", source: "", medium: "", campaign: "", device: dims.device });
  }
  bump(S.pv, key);
  S.lastAcceptedAt = nowMs;
}

export function recordVital(dims: VitalDims, nowMs: number = now()): void {
  if (nowMs < S.missingUntil) return;
  ensureStarted();
  const day = trDayKey(nowMs);
  let key = wvKey(day, dims);
  if (!admit(S.seenWv, day, key)) {
    S.overflowed += 1;
    key = wvKey(day, { ...dims, path_tpl: OVERFLOW_PATH });
  }
  bump(S.wv, key);
  S.lastAcceptedAt = nowMs;
}

export type FlushResult = { ok: boolean; pv: number; wv: number; reason?: "empty" | "missing" | "error" };

function isMissing(code: string | undefined): boolean {
  // 42883: fonksiyon yok, PGRST202: şema önbelleğinde RPC yok, 42P01: tablo yok.
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

function rowsOf(map: Map<string, number>, kind: "pv" | "wv"): Record<string, unknown>[] {
  return [...map.entries()].map(([k, n]) => {
    const p = k.split(SEP);
    return kind === "pv"
      ? { day: p[0], path_tpl: p[1], channel: p[2], source: p[3], medium: p[4], campaign: p[5], device: p[6], n }
      : { day: p[0], path_tpl: p[1], device: p[2], metric: p[3], bucket: Number(p[4]), static: p[5] === "1", n };
  });
}

/** Bekleyen sayaçları tek RPC ile yazar. Aynı anda tek boşaltma çalışır. ASLA fırlatmaz. */
export function flushMeasureBuffer(nowMs: number = now()): Promise<FlushResult> {
  if (S.flushing) return S.flushing;
  S.flushing = doFlush(nowMs).finally(() => {
    S.flushing = null;
  });
  return S.flushing;
}

async function doFlush(nowMs: number): Promise<FlushResult> {
  if (!S.pv.size && !S.wv.size) return { ok: true, pv: 0, wv: 0, reason: "empty" };
  const pv = new Map(S.pv);
  const wv = new Map(S.wv);
  S.pv.clear();
  S.wv.clear();
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("analytics_ingest", { p: { pv: rowsOf(pv, "pv"), wv: rowsOf(wv, "wv") } });
    S.lastFlushAt = nowMs;
    if (error) {
      if (isMissing(error.code)) {
        S.missingUntil = nowMs + MISSING_RETRY_MS;
        S.lastError = { at: nowMs, message: "Ölçüm tabloları henüz kurulmamış (migration bekliyor)." };
        return { ok: false, pv: 0, wv: 0, reason: "missing" };
      }
      throw new Error(error.message);
    }
    S.lastError = null;
    return { ok: true, pv: pv.size, wv: wv.size };
  } catch (e) {
    S.failures += 1;
    S.lastError = { at: nowMs, message: e instanceof Error ? e.message.slice(0, 200) : "bilinmeyen hata" };
    // Geçici hata: sayaçlar geri konur (tavan korunur), bir sonraki turda yeniden denenir.
    for (const [k, n] of pv) bump(S.pv, k, n);
    for (const [k, n] of wv) bump(S.wv, k, n);
    return { ok: false, pv: 0, wv: 0, reason: "error" };
  }
}

type SignalTarget = {
  once(event: "SIGTERM", fn: () => void): unknown;
  listenerCount(event: "SIGTERM"): number;
  kill(pid: number, signal: "SIGTERM"): unknown;
  pid: number;
};

/**
 * SIGTERM'de son boşaltma. Next'in kendi kapanış dinleyicisi varsa (standalone sunucu) çıkışı o yapar; yoksa
 * boşaltmadan sonra sinyal yeniden gönderilir (dinleyici eklemek varsayılan "çık" davranışını bozmasın).
 */
export function installShutdownFlush(proc: SignalTarget = process as unknown as SignalTarget): void {
  proc.once("SIGTERM", () => {
    void flushMeasureBuffer().finally(() => {
      if (proc.listenerCount("SIGTERM") === 0) proc.kill(proc.pid, "SIGTERM");
    });
  });
}

function ensureStarted(): void {
  if (S.timer) return;
  S.timer = setInterval(() => {
    void flushMeasureBuffer();
  }, FLUSH_INTERVAL_MS);
  S.timer.unref?.();
  if (!S.shutdownHooked && typeof process !== "undefined" && typeof process.once === "function") {
    S.shutdownHooked = true;
    installShutdownFlush();
  }
}

export type MeasureBufferStats = {
  pendingPageviews: number;
  pendingVitals: number;
  lastFlushAt: number | null;
  lastAcceptedAt: number | null;
  lastError: { at: number; message: string } | null;
  failures: number;
  dropped: number;
  overflowed: number;
  tableMissing: boolean;
};

/** Sağlık notu için süreç içi durum (yalnız bu sürecin gözlemi; yeniden başlatmada sıfırlanır). */
export function measureBufferStats(nowMs: number = now()): MeasureBufferStats {
  return {
    pendingPageviews: S.pv.size,
    pendingVitals: S.wv.size,
    lastFlushAt: S.lastFlushAt || null,
    lastAcceptedAt: S.lastAcceptedAt || null,
    lastError: S.lastError,
    failures: S.failures,
    dropped: S.dropped,
    overflowed: S.overflowed,
    tableMissing: nowMs < S.missingUntil,
  };
}

/** Yalnız testler: süreç içi durumu sıfırlar. */
export function resetMeasureBufferForTest(): void {
  if (S.timer) clearInterval(S.timer);
  S.timer = null;
  S.shutdownHooked = true; // testte gerçek SIGTERM dinleyicisi kurulmaz
  S.pv.clear();
  S.wv.clear();
  S.seenPv = { day: "", keys: new Set() };
  S.seenWv = { day: "", keys: new Set() };
  S.missingUntil = 0;
  S.lastFlushAt = 0;
  S.lastAcceptedAt = 0;
  S.lastError = null;
  S.failures = 0;
  S.dropped = 0;
  S.overflowed = 0;
  S.flushing = null;
}

/** Yalnız testler: zamanlayıcıyı (sahte saatle) başlatır. */
export function startMeasureBufferTimerForTest(): void {
  ensureStarted();
}
