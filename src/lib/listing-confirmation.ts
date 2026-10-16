/**
 * İLAN TEYİT SAĞLIĞI — tek tanım (ana ekran "Ofis durumu", ofis skoru; saf, vitest: listing-confirmation.test.ts).
 *
 * Yayındaki ilanın son teyit anı `last_confirmed_at`; hiç teyit damgası yoksa ilanın portala çıkış anı (`published_at`),
 * o da yoksa kayıt anı (`created_at`) başlangıç sayılır. Eskiden damgasız her ilan "999 gün" sayılıp anında gecikmiş
 * görünüyordu: içe aktarılmış ya da elle eklenmiş taze ilanlar "İlan teyit sağlığı %0" üretiyordu. 7 gün ve üstü →
 * teyit bekliyor. Hiç yayında ilan yoksa sağlık YOK (null; "%100" ya da "%0" uydurulmaz).
 */

export const LISTING_CONFIRM_STALE_DAYS = 7;
const DAY_MS = 86_400_000;

export type ConfirmableListing = {
  last_confirmed_at: string | null;
  published_at?: string | null;
  created_at?: string | null;
};

/** Teyit yaşının başlangıç anı (ms); hiçbir damga yoksa null. */
export function confirmationBaseMs(r: ConfirmableListing): number | null {
  for (const v of [r.last_confirmed_at, r.published_at, r.created_at]) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/** Son teyitten (yoksa yayından) bu yana tam gün; hiç damga yoksa Infinity. */
export function confirmationAgeDays(r: ConfirmableListing, nowMs: number): number {
  const base = confirmationBaseMs(r);
  return base == null ? Number.POSITIVE_INFINITY : Math.floor(Math.max(0, nowMs - base) / DAY_MS);
}

export function isConfirmationOverdue(r: ConfirmableListing, nowMs: number): boolean {
  return confirmationAgeDays(r, nowMs) >= LISTING_CONFIRM_STALE_DAYS;
}

/** Sağlık yüzdesi bir ondalık ("%77,8"); yayında ilan yoksa null. */
export function confirmationHealth(rows: readonly ConfirmableListing[], nowMs: number): { total: number; overdue: number; pct: number | null } {
  const total = rows.length;
  const overdue = rows.filter((r) => isConfirmationOverdue(r, nowMs)).length;
  return { total, overdue, pct: total > 0 ? Math.round(((total - overdue) / total) * 1000) / 10 : null };
}
