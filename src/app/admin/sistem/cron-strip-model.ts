/**
 * Cron durum şeridi sınıflandırması (saf). Tabloda yalnız SON durum tutulur (cron_heartbeats: ok | error);
 * geçmiş çalışma kaydı ve "atlandı" durumu saklanmadığından şerit bunları üretmez.
 * Kural /admin/sistem ve cron-staleness ile aynıdır: hiç çalışmadı > bayat > hata > sağlıklı.
 */
export type CronCellStatus = "ok" | "error" | "stale" | "never";

export type CronHeartbeatLite = { last_run_at: string | null; last_status: string | null } | undefined;

export function classifyCron(hb: CronHeartbeatLite, staleAfterMinutes: number, nowMs: number): CronCellStatus {
  const ts = hb?.last_run_at ? Date.parse(hb.last_run_at) : NaN;
  if (!hb || Number.isNaN(ts)) return "never";
  if (nowMs - ts > staleAfterMinutes * 60_000) return "stale";
  if (hb.last_status === "error") return "error";
  return "ok";
}

export const CRON_STATUS_LABEL: Record<CronCellStatus, string> = {
  ok: "Sağlıklı",
  error: "Hata",
  stale: "Gecikmiş",
  never: "Hiç çalışmadı",
};

export function countByStatus(statuses: readonly CronCellStatus[]): Record<CronCellStatus, number> {
  const out: Record<CronCellStatus, number> = { ok: 0, error: 0, stale: 0, never: 0 };
  for (const s of statuses) out[s] += 1;
  return out;
}

/** Şema denetimi için gauge girdisi: gerçek oran, kontrol yoksa null (gauge çizilmez). */
export function schemaGauge(rows: readonly { ok: boolean }[]): { ok: number; total: number } | null {
  if (rows.length === 0) return null;
  return { ok: rows.filter((r) => r.ok).length, total: rows.length };
}

/** İl kapsamı: yüzde 0-100'e kırpılır. */
export function geoCoverage(provinces: number | null, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round(((provinces ?? 0) / total) * 100)));
}
