/**
 * SONUÇ KUYRUĞU (outbox) + GERİ ÇEKİLME (SAF, testli; saat dışarıdan verilir). Eklenti portal sayfasını okuduktan sonra
 * EmlakSoft'a sonuç gönderemezse (çevrimdışı, 5xx, oturum geçici kapalı) sonucu `chrome.storage.local`'de saklar ve sonra
 * AYNI iş kimliğiyle yeniden dener. Sunucudaki `lc_worker_complete` iş kimliğine göre idempotenttir (`replay`): aynı sonuç iki
 * kez gitse çift kayıt oluşmaz. Portal TEKRAR sorgulanmaz (hız sınırı korunur); yalnız EmlakSoft'a gönderim yinelenir.
 */

export const OUTBOX_MAX = 50;
/** Sunucudaki iş kirası dolduktan sonra da `replay` güvenlidir, ama sonsuza dek tutulmaz. */
export const OUTBOX_TTL_MS = 24 * 3_600_000;
export const OUTBOX_MAX_ATTEMPTS = 12;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;

export type OutboxEntry = {
  /** İdempotency anahtarı: sunucu iş kimliği. */
  jobId: string;
  clientId: string;
  result: string;
  observed: Record<string, unknown>;
  /** Ayrıştırıcı telemetrisi (yalnız sayaç alanları). */
  telemetry: Record<string, unknown> | null;
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
};

/** Üstel geri çekilme: 30 sn, 1 dk, 2 dk ... en çok 15 dk. */
export function backoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

export function prune(list: readonly OutboxEntry[], nowMs: number): OutboxEntry[] {
  return list.filter((e) => nowMs - e.queuedAt < OUTBOX_TTL_MS && e.attempts < OUTBOX_MAX_ATTEMPTS).slice(-OUTBOX_MAX);
}

/** Aynı iş kimliği tekrar eklenirse eskisinin yerine geçer (çift kuyruk girişi oluşmaz). */
export function enqueue(list: readonly OutboxEntry[], entry: Omit<OutboxEntry, "attempts" | "nextAttemptAt" | "queuedAt">, nowMs: number): OutboxEntry[] {
  const rest = list.filter((e) => e.jobId !== entry.jobId);
  return prune([...rest, { ...entry, queuedAt: nowMs, attempts: 0, nextAttemptAt: nowMs }], nowMs);
}

export function dueEntries(list: readonly OutboxEntry[], nowMs: number): OutboxEntry[] {
  return prune(list, nowMs)
    .filter((e) => e.nextAttemptAt <= nowMs)
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

export function markFailed(list: readonly OutboxEntry[], jobId: string, nowMs: number): OutboxEntry[] {
  return prune(
    list.map((e) => (e.jobId === jobId ? { ...e, attempts: e.attempts + 1, nextAttemptAt: nowMs + backoffMs(e.attempts + 1) } : e)),
    nowMs,
  );
}

export function markDone(list: readonly OutboxEntry[], jobId: string): OutboxEntry[] {
  return list.filter((e) => e.jobId !== jobId);
}

export type SendVerdict = "done" | "retry" | "drop";

/**
 * Uç yanıtını karara çevirir. `done`: sunucu kabul etti ya da zaten işlenmişti (replay). `retry`: ağ/5xx/429/oturum
 * (geçici). `drop`: sunucu kalıcı reddetti (geçersiz iş, süresi dolmuş iş, şema yok): tekrar denemek anlamsız.
 */
export function sendVerdict(status: number, data: { ok?: boolean; error?: string; outcome?: string }): SendVerdict {
  if (status === 0 || status >= 500 || status === 429 || status === 401) return "retry";
  if (data.ok === true) return "done";
  if (data.error === "rpc_error" || data.error === "network") return "retry";
  return "drop";
}
