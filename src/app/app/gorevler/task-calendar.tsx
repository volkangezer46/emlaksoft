import Link from "@/components/ui/smart-link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { trDayKey } from "@/lib/clock";
import { buildMonthGrid, monthLabel, WEEKDAY_SHORT } from "@/lib/month-grid";

export type CalendarTask = {
  id: string;
  title: string;
  status: string;
  due_at: string;
  priority: string;
};

const MAX_PER_DAY = 3;

/**
 * Görev takvimi (vade): ay ızgarası, sunucuda çizilir. Her gün hücresi o günün liste
 * görünümüne (`?gun=`) gider; ay oku `?ay=` ile gezinir (filtre kontratı korunur).
 */
export function TaskCalendar({
  monthKey,
  tasks,
  todayKey,
  prevHref,
  nextHref,
  dayHref,
  truncated,
}: {
  monthKey: string;
  tasks: CalendarTask[];
  todayKey: string;
  prevHref: string;
  nextHref: string;
  dayHref: (dayKey: string) => string;
  truncated: boolean;
}) {
  const byDay = new Map<string, CalendarTask[]>();
  for (const t of tasks) {
    const k = trDayKey(t.due_at);
    const list = byDay.get(k);
    if (list) list.push(t);
    else byDay.set(k, [t]);
  }
  const weeks = buildMonthGrid(monthKey);

  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <Link href={prevHref} aria-label="Önceki ay" className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:border-brand-300 hover:text-brand-600">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h2 className="font-display text-base font-bold text-ink-950">{monthLabel(monthKey)}</h2>
        <Link href={nextHref} aria-label="Sonraki ay" className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:border-brand-300 hover:text-brand-600">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      {truncated ? (
        <p className="border-b border-line bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-700">
          Bu ayda çok sayıda görev var; takvimde ilk 1000 görev gösteriliyor. Gün hücresine tıklayarak tam listeyi açın.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-xs">
          <thead>
            <tr>
              {WEEKDAY_SHORT.map((d) => (
                <th key={d} scope="col" className="border-b border-line px-2 py-2 text-left font-bold uppercase tracking-wide text-text-muted">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]!.dayKey}>
                {week.map((d) => {
                  const list = byDay.get(d.dayKey) ?? [];
                  const open = list.filter((t) => t.status === "open");
                  const overdue = d.dayKey < todayKey && open.length > 0;
                  return (
                    <td key={d.dayKey} className={`h-28 border border-line align-top ${d.inMonth ? "bg-surface" : "bg-canvas/60"}`}>
                      <Link
                        href={dayHref(d.dayKey)}
                        className="focus-ring flex h-full flex-col gap-1 p-1.5 transition hover:bg-brand-600/[0.04]"
                        aria-label={`${d.dayKey}: ${list.length} görev`}
                      >
                        <span className={`flex items-center justify-between font-semibold ${d.inMonth ? "text-ink-950" : "text-text-faint"}`}>
                          <span className={d.dayKey === todayKey ? "grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white" : ""}>{d.day}</span>
                          {list.length > 0 ? (
                            <span className={`numeric rounded-full px-1.5 py-0.5 font-bold ${overdue ? "bg-danger-500/10 text-danger-500" : "bg-ink-950/6 text-text-muted"}`}>
                              {list.length}
                            </span>
                          ) : null}
                        </span>
                        {list.slice(0, MAX_PER_DAY).map((t) => (
                          <span
                            key={t.id}
                            className={`truncate rounded px-1.5 py-0.5 ${
                              t.status === "done"
                                ? "bg-mint-500/10 text-mint-700 line-through"
                                : overdue
                                  ? "bg-danger-500/10 text-danger-600"
                                  : t.priority === "high"
                                    ? "bg-amber-400/15 text-amber-700"
                                    : "bg-brand-600/8 text-brand-700"
                            }`}
                          >
                            {t.title}
                          </span>
                        ))}
                        {list.length > MAX_PER_DAY ? (
                          <span className="font-semibold text-brand-600">+{list.length - MAX_PER_DAY} daha</span>
                        ) : null}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
