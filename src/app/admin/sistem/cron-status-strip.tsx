import Link from "next/link";
import { CRON_STATUS_LABEL, countByStatus, type CronCellStatus } from "./cron-strip-model";

const CELL_COLOR: Record<CronCellStatus, string> = {
  ok: "var(--viz-pos)",
  error: "var(--viz-neg)",
  stale: "var(--viz-5)",
  never: "var(--hairline-strong)",
};

export type CronStripItem = { job: string; label: string; status: CronCellStatus; when: string };

/**
 * Cron durum şeridi: her iş küçük bir kare (son durum). Tıklayınca aynı sayfadaki iş satırına gider (#cron-<iş>).
 * Yalnız SON durum gösterilir; geçmiş çalışma kaydı tutulmadığı için sahte geçmiş çizilmez.
 */
export function CronStatusStrip({ items }: { items: readonly CronStripItem[] }) {
  const counts = countByStatus(items.map((i) => i.status));
  return (
    <section aria-label="Cron durum şeridi" className="@container surface-card rounded-[var(--radius-panel)] p-5" style={{ boxShadow: "var(--elev-3)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold text-ink-950">Cron sağlığı</h2>
        <p className="text-xs tabular-nums text-text-muted">
          {counts.ok}/{items.length} sağlıklı
          {counts.error ? ` · ${counts.error} hata` : ""}
          {counts.stale ? ` · ${counts.stale} gecikmiş` : ""}
          {counts.never ? ` · ${counts.never} hiç çalışmadı` : ""}
        </p>
      </div>
      <ul className="m-0 mt-3 grid list-none grid-cols-[repeat(auto-fill,minmax(1.5rem,1fr))] gap-1.5 p-0" style={{ minHeight: 28 }}>
        {items.map((i) => (
          <li key={i.job}>
            <Link
              href={`#cron-${i.job}`}
              title={`${i.label}: ${CRON_STATUS_LABEL[i.status]} · ${i.when}`}
              aria-label={`${i.label}: ${CRON_STATUS_LABEL[i.status]}, ${i.when}`}
              className="block aspect-square rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
              style={{ background: CELL_COLOR[i.status] }}
            />
          </li>
        ))}
      </ul>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        {(Object.keys(CELL_COLOR) as CronCellStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CELL_COLOR[s] }} />
            {CRON_STATUS_LABEL[s]}
          </span>
        ))}
        <span className="text-text-faint">Yalnız son durum tutulur; çalışma geçmişi kaydedilmez.</span>
      </p>
    </section>
  );
}
