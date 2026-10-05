/**
 * Cron çalıştırma yardımcıları (SAF; DB yok): sayfalama, zaman bütçesi ve heartbeat sonucu.
 *
 * Desen (ef-kontor-hak): `order(id)` + `range` ile sayfalama, parça (chunk) işleme, 240 sn zaman bütçesi,
 * kalan iş sayısı heartbeat detayına, kısmi hatada heartbeat 'error' (yalnız TAM başarıda 'ok').
 */

/** Vercel maxDuration (300 sn) altında güvenli zaman bütçesi. */
export const CRON_BUDGET_MS = 240_000;
export const CRON_PAGE_SIZE = 1000;

export function cronDeadline(startMs: number, budgetMs: number = CRON_BUDGET_MS): number {
  return startMs + budgetMs;
}

export function isPastDeadline(nowMs: number, deadlineMs: number): boolean {
  return nowMs >= deadlineMs;
}

export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  if (size <= 0) return [items.slice()];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Sıralı sayfalarla tüm satırları toplar. `fetchPage(from, to)` aralığı DAİMA deterministik sıralı (order(id)) çekmeli.
 * Hata olursa o ana kadar toplananlar + `error` döner (çağıran kısmi işlemi 'error' heartbeat ile bildirir).
 */
export async function fetchAllPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = CRON_PAGE_SIZE,
  maxPages = 200,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const res = await fetchPage(from, from + pageSize - 1);
    if (res.error) return { rows, error: res.error.message };
    const got = res.data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return { rows, error: null };
  }
  return { rows, error: `sayfa üst sınırı (${maxPages}) aşıldı` };
}

export type RunOutcome = {
  /** Toplam iş (ör. ofis) sayısı. */
  total: number;
  /** İşlenen iş sayısı. */
  processed: number;
  /** Hata alan iş sayısı. */
  failed: number;
  /** Zaman bütçesi dolduğu için bırakıldı mı. */
  timedOut: boolean;
  /** Listeyi okurken hata oldu mu (kısmi liste). */
  listError?: string | null;
  /** Özet metni (ör. "12 özet gönderildi"). */
  summary: string;
};

/** Kalan iş sayısı (işlenmemiş) — heartbeat detayına yazılır. */
export function remainingOf(outcome: Pick<RunOutcome, "total" | "processed">): number {
  return Math.max(0, outcome.total - outcome.processed);
}

/** Yalnız tam başarıda 'ok': hata, zaman aşımı/kalan iş veya liste hatası varsa 'error'. */
export function heartbeatFor(outcome: RunOutcome): { status: "ok" | "error"; detail: string } {
  const remaining = remainingOf(outcome);
  const parts = [outcome.summary];
  if (outcome.failed > 0) parts.push(`${outcome.failed} hata`);
  if (remaining > 0) parts.push(`${remaining} iş kaldı${outcome.timedOut ? " (zaman bütçesi doldu)" : ""}`);
  if (outcome.listError) parts.push(`liste hatası: ${outcome.listError}`);
  const status = outcome.failed > 0 || remaining > 0 || outcome.timedOut || Boolean(outcome.listError) ? "error" : "ok";
  return { status, detail: parts.join(" · ") };
}
