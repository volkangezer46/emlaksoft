import Link from "@/components/ui/smart-link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatTrTime, trDayKey } from "@/lib/clock";
import { buildMonthGrid, monthLabel, WEEKDAY_SHORT } from "@/lib/month-grid";

export type CalendarTask = {
  id: string;
  title: string;
  status: string;
  due_at: string;
  priority: string;
};

const MAX_PER_DAY = 3;

const DAY_LABEL = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function dayHeading(dayKey: string, todayKey: string): string {
  const label = DAY_LABEL.format(new Date(`${dayKey}T00:00:00Z`));
  return dayKey === todayKey ? `Bugün · ${label}` : label;
}

/**
 * Görev takvimi (vade): ay ızgarası, sunucuda çizilir.
 * MP10/GA-03 mobil (<768 px): 720 px tablo yerine yatay kaydırmasız SIKI ay ızgarası (44 px gün düğmeleri, sayı rozeti)
 * + günlere bölünmüş ajanda listesi (saat sıralı, her görev kendi kaydını açar). Masaüstü tablo değişmez. Her gün hücresi o günün liste
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
        <Link href={prevHref} aria-label="Önceki ay" className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:border-brand-300 hover:text-brand-600 touch:min-h-11 touch:min-w-11">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h2 className="font-display text-base font-bold text-ink-950">{monthLabel(monthKey)}</h2>
        <Link href={nextHref} aria-label="Sonraki ay" className="focus-ring grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:border-brand-300 hover:text-brand-600 touch:min-h-11 touch:min-w-11">
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      {truncated ? (
        <p className="border-b border-line bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-700">
          Bu ayda çok sayıda görev var; takvimde ilk 1000 görev gösteriliyor. Gün hücresine tıklayarak tam listeyi açın.
        </p>
      ) : null}
      {/* Mobil: sıkı ay ızgarası + ajanda (yatay kaydırma yok). */}
      <div className="md:hidden">
        <div className="grid grid-cols-7 gap-1 px-2 pt-2 text-center text-[11px] font-bold uppercase text-text-muted" aria-hidden>
          {WEEKDAY_SHORT.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 p-2">
          {weeks.flat().map((d) => {
            const list = byDay.get(d.dayKey) ?? [];
            const open = list.filter((t) => t.status === "open").length;
            const overdue = d.dayKey < todayKey && open > 0;
            return (
              <Link
                key={d.dayKey}
                href={dayHref(d.dayKey)}
                aria-label={`${d.dayKey}: ${list.length} görev`}
                className={`focus-ring flex min-h-11 flex-col items-center justify-center rounded-[var(--radius-control)] text-sm font-semibold transition ${
                  d.dayKey === todayKey
                    ? "bg-brand-600 text-white"
                    : d.inMonth
                      ? "text-ink-950 hover:bg-brand-600/[0.06]"
                      : "text-text-faint"
                }`}
              >
                {d.day}
                {list.length > 0 ? (
                  <span
                    className={`numeric mt-0.5 min-w-4 rounded-full px-1 text-[10px] font-bold leading-4 ${
                      d.dayKey === todayKey ? "bg-white/25 text-white" : overdue ? "bg-danger-500/12 text-danger-600" : "bg-brand-600/10 text-brand-700"
                    }`}
                  >
                    {list.length}
                  </span>
                ) : (
                  <span className="mt-0.5 h-4" aria-hidden />
                )}
              </Link>
            );
          })}
        </div>
        <AgendaList byDay={byDay} todayKey={todayKey} monthKey={monthKey} dayHref={dayHref} />
      </div>

      <div className="hidden overflow-x-auto md:block">
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

/** Mobil ajanda: ayın görevleri günlere bölünmüş, saat sıralı; geçmiş günlerde yalnız açık (geciken) görevler. */
function AgendaList({
  byDay,
  todayKey,
  monthKey,
  dayHref,
}: {
  byDay: Map<string, CalendarTask[]>;
  todayKey: string;
  monthKey: string;
  dayHref: (dayKey: string) => string;
}) {
  const days = [...byDay.entries()]
    .filter(([k]) => k.startsWith(monthKey))
    .map(([k, list]) => [k, k < todayKey ? list.filter((t) => t.status === "open") : list] as const)
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (days.length === 0) {
    return <p className="border-t border-line px-4 py-6 text-center text-sm text-text-muted">Bu ayda vadeli görev yok.</p>;
  }
  return (
    <ol className="divide-y divide-line border-t border-line">
      {days.map(([k, list]) => (
        <li key={k} className="px-3 py-3">
          <Link
            href={dayHref(k)}
            className={`focus-ring inline-flex min-h-8 items-center rounded-sm text-xs font-bold uppercase tracking-wide ${
              k < todayKey ? "text-danger-600" : k === todayKey ? "text-brand-700" : "text-text-muted"
            }`}
          >
            {k < todayKey ? `Gecikti · ${dayHeading(k, todayKey)}` : dayHeading(k, todayKey)}
          </Link>
          <ul className="mt-1 space-y-1">
            {[...list]
              .sort((a, b) => a.due_at.localeCompare(b.due_at))
              .map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/app/gorevler?gorev=${t.id}`}
                    className="focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 transition hover:border-brand-300"
                  >
                    <span className="numeric w-11 shrink-0 text-xs font-semibold text-text-muted">{formatTrTime(t.due_at)}</span>
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${t.status === "done" ? "text-text-faint line-through" : "font-semibold text-ink-950"}`}
                    >
                      {t.title}
                    </span>
                    {t.priority === "high" && t.status === "open" ? (
                      <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-700">Yüksek</span>
                    ) : null}
                  </Link>
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
