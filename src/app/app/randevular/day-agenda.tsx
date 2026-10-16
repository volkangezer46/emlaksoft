import { DAY_MS, now, trDayKey, trParts } from "@/lib/clock";
import { AgendaList } from "./agenda-list";
import type { WeekGridDay, WeekViewAppointment, WeekViewTask } from "./week-grid";

const LONG = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Istanbul" });
const SHORT = new Intl.DateTimeFormat("tr-TR", { weekday: "short", timeZone: "Europe/Istanbul" });

/**
 * "Bugün ve yarın" gün listesi (sadeleştirme C18; sade modda randevuların varsayılan görünümü). Danışmanın sorusu
 * "bugün kiminle buluşuyorum": ay takvimi yerine iki günün randevuları ve saatli görevleri saat sırasıyla, her satır
 * kaydın kendisini açar. Ay / hafta / gün / rota görünümleri "Görünüm" menüsünde kalır.
 */
export function DayAgenda({
  appointments,
  tasks,
  dayHref,
  newHref,
  canEdit,
  canEditTasks,
}: {
  appointments: WeekViewAppointment[];
  tasks: WeekViewTask[];
  dayHref: (dayKey: string) => string;
  newHref: string | null;
  canEdit: boolean;
  canEditTasks: boolean;
}) {
  // Gün sınırı ofis saatine göre (clock.ts; sunucu TZ'sinden bağımsız).
  const nowMs = now();
  const days: WeekGridDay[] = [0, 1].map((offset) => {
    const at = nowMs + offset * DAY_MS;
    return {
      key: trDayKey(at),
      weekday: SHORT.format(at),
      dayNum: trParts(at).day,
      isToday: offset === 0,
      longLabel: LONG.format(at),
      label: offset === 0 ? "Bugün" : "Yarın",
    };
  });
  return (
    <section aria-label="Bugün ve yarın" data-day-agenda="" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <AgendaList
        mode="liste"
        days={days}
        appointments={appointments}
        tasks={tasks}
        dayHref={dayHref}
        newHref={newHref}
        nowMs={nowMs}
        canEdit={canEdit}
        canEditTasks={canEditTasks}
      />
    </section>
  );
}
