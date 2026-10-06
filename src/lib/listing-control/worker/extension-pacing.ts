import { WORKER_LIMITS } from "./core";

/**
 * TARAYICI EKLENTİSİ HIZ VE LİDER KURALLARI (SAF; saat dışarıdan verilir, testli). Eklentinin service worker'ı bütün
 * portal isteklerini TEK kuyruktan geçirir: iki istek arası en az 20 sn + rastgele sapma, saatte en fazla 60, günde en
 * fazla 600 (sayılar `WORKER_LIMITS` ile aynı kaynaktan). Birden çok EmlakSoft sekmesi açıksa yalnız BİR sekme (lider)
 * otomatik kontrol döngüsünü yürütür; lider sekme kapanınca kira süresi (90 sn) dolar ve başka sekme devralır. Hiç
 * EmlakSoft sekmesi yoksa döngü yoktur (kontrol durur). Bu kurallar hız sınırını AŞMAK için değil, portalı yormamak içindir.
 */

export const EXTENSION_LIMITS = {
  minIntervalMs: WORKER_LIMITS.minIntervalMs,
  jitterMs: WORKER_LIMITS.jitterMs,
  maxPerHour: WORKER_LIMITS.maxPerHour,
  maxPerDay: 600,
  leaseMs: 90_000,
  /** Portal 429/CAPTCHA dönerse bütün kontroller bu süre durur (aşmaya çalışılmaz). */
  blockCooldownMs: 30 * 60_000,
  /** Mağaza (liste) sayfası okumada en fazla sayfa. */
  maxStorePages: 10,
} as const;

export type PacingState = {
  /** Bir sonraki portal isteğine izin verilen an (ms). */
  nextAllowedAtMs: number;
  /** Son 1 saatteki istek anları (ms). */
  recentMs: number[];
  /** Gün anahtarı (YYYY-MM-DD, yerel) ve o günkü istek sayısı. */
  dayKey: string;
  dayCount: number;
  /** Portal engeli sonrası bekleme bitişi (ms; 0 = yok). */
  cooldownUntilMs: number;
};

export const INITIAL_PACING: PacingState = { nextAllowedAtMs: 0, recentMs: [], dayKey: "", dayCount: 0, cooldownUntilMs: 0 };

export type PacingDecision = { ok: true } | { ok: false; waitMs: number; reason: "interval" | "hour_cap" | "day_cap" | "cooldown" };

/** Şimdi bir portal isteği yapılabilir mi? `dayKey` çağıranın yerel günü. */
export function pacingDecision(state: PacingState, nowMs: number, dayKey: string): PacingDecision {
  if (state.cooldownUntilMs > nowMs) return { ok: false, waitMs: state.cooldownUntilMs - nowMs, reason: "cooldown" };
  if (state.dayKey === dayKey && state.dayCount >= EXTENSION_LIMITS.maxPerDay) return { ok: false, waitMs: 60 * 60_000, reason: "day_cap" };
  const hourAgo = nowMs - 3_600_000;
  const recent = state.recentMs.filter((t) => t > hourAgo).sort((a, b) => a - b);
  if (recent.length >= EXTENSION_LIMITS.maxPerHour) return { ok: false, waitMs: Math.max(1_000, recent[0] + 3_600_000 - nowMs), reason: "hour_cap" };
  if (state.nextAllowedAtMs > nowMs) return { ok: false, waitMs: state.nextAllowedAtMs - nowMs, reason: "interval" };
  return { ok: true };
}

/** Yapılan bir isteği kaydeder; bir sonraki izin anı = şimdi + 20 sn + rand*10 sn. `rand` 0..1. */
export function recordRequest(state: PacingState, nowMs: number, dayKey: string, rand: number): PacingState {
  const r = Math.min(Math.max(rand, 0), 1);
  const hourAgo = nowMs - 3_600_000;
  return {
    nextAllowedAtMs: nowMs + EXTENSION_LIMITS.minIntervalMs + Math.round(r * EXTENSION_LIMITS.jitterMs),
    recentMs: [...state.recentMs.filter((t) => t > hourAgo), nowMs],
    dayKey,
    dayCount: state.dayKey === dayKey ? state.dayCount + 1 : 1,
    cooldownUntilMs: state.cooldownUntilMs,
  };
}

/** Portal engel/hız sınırı döndürdüyse (429, CAPTCHA, giriş duvarı) bütün kontroller bir süre durur. */
export function applyBlockCooldown(state: PacingState, nowMs: number, error: string | null | undefined): PacingState {
  if (!error || !/^(http_429|http_403|captcha|login_required)$/.test(error)) return state;
  return { ...state, cooldownUntilMs: Math.max(state.cooldownUntilMs, nowMs + EXTENSION_LIMITS.blockCooldownMs) };
}

/** Bugün yapılan kontrol sayısı (popup). */
export function todayCount(state: PacingState, dayKey: string): number {
  return state.dayKey === dayKey ? state.dayCount : 0;
}

export type Lease = { token: string; expiresAtMs: number } | null;

/** Lider kirası: kira boşsa/süresi dolduysa ya da zaten bu sekmedeyse verilir ve uzatılır. */
export function leaseDecision(lease: Lease, token: string, nowMs: number): { granted: boolean; lease: Lease } {
  if (!token) return { granted: false, lease };
  if (!lease || lease.expiresAtMs <= nowMs || lease.token === token) {
    return { granted: true, lease: { token, expiresAtMs: nowMs + EXTENSION_LIMITS.leaseMs } };
  }
  return { granted: false, lease };
}

/** Sekme kapanınca kirayı bırakır (başka sekme beklemeden devralır). */
export function releaseLease(lease: Lease, token: string): Lease {
  return lease && lease.token === token ? null : lease;
}

/** Yerel gün anahtarı (YYYY-MM-DD). Saat dışarıdan verilir. */
export function localDayKey(nowMs: number, tzOffsetMinutes: number): string {
  const d = new Date(nowMs - tzOffsetMinutes * 60_000);
  return d.toISOString().slice(0, 10);
}
