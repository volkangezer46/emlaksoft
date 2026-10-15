import dynamic from "next/dynamic";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import Link from "@/components/ui/smart-link";
import { now, trTodayCalendarDate } from "@/lib/clock";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AgendaList } from "./agenda-list";
import type { WeekGridDay, WeekViewAppointment, WeekViewTask } from "./week-grid";

export type { WeekViewAppointment, WeekViewTask } from "./week-grid";

/**
 * Hafta / gün görünümü — ?gorunum=hafta|gun (ay: mevcut AppointmentCalendar).
 *
 * Sunucu kabuğu: gezinme ?tarih= linkleriyle yapılır (prev/next/bugün hrefleri sayfada hesaplanır).
 *  - ≥640 px: saat ızgarası istemci adası (`week-grid.tsx`, ayrı parça): sürükle-bırak ile saat/gün/süre değiştirme
 *    (GA-02), saatli görevler sarı blok (GA-03); blok tıklaması randevunun kendisini açar (`?randevu=<id>`).
 *  - <640 px: yatay kaydırmalı 7 sütun yerine tek akış ajanda (GA-03; hafta şeridi + saat sıralı kartlar).
 */
const WeekGrid = dynamic(() => import("./week-grid").then((m) => m.WeekGrid), {
  loading: () => <div className="h-[672px] animate-pulse rounded-[var(--radius-control)] bg-canvas" aria-hidden />,
});

const TYPE_COLOR: Record<string, string> = {
  showing: "bg-brand-600",
  office: "bg-cyan-500",
  valuation: "bg-amber-500",
  contract: "bg-mint-500",
};

const TYPE_LABEL = APPOINTMENT_TYPE_LABELS;

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Takvim günü (sahte yerel Date) → "YYYY-MM-DD"; randevuların TR gün anahtarıyla karşılaştırılır. */
function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AppointmentWeekView({
  mode,
  date,
  appointments,
  tasks = [],
  prevHref,
  nextHref,
  todayHref,
  dayHref,
  newHref = null,
  canEdit = false,
  canEditTasks = false,
}: {
  mode: "hafta" | "gun";
  /** Seçili gün (yerel saat, gün başı). */
  date: Date;
  appointments: WeekViewAppointment[];
  /** GA-03: penceredeki saatli açık görevler (kullanıcının ya da seçili danışmanın). */
  tasks?: WeekViewTask[];
  prevHref: string;
  nextHref: string;
  todayHref: string;
  /** Mobil hafta şeridindeki gün → o günün gün görünümü. */
  dayHref: (dayKey: string) => string;
  /** Randevu oluşturma yetkisi varsa yeni randevu sayfası adresi; yoksa null (boş saat bağlantıları çizilmez). */
  newHref?: string | null;
  /** Sürükle-bırak (appointments.edit). */
  canEdit?: boolean;
  /** Görev bloğunda tamamla düğmesi (tasks.edit). */
  canEditTasks?: boolean;
}) {
  const today = trTodayCalendarDate();

  // Hafta: seçili günü içeren Pazartesi–Pazar; gün: tek kolon.
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const dates: Date[] =
    mode === "hafta"
      ? Array.from({ length: 7 }, (_, i) => {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          return d;
        })
      : [date];
  const days: WeekGridDay[] = dates.map((d) => ({
    key: dayKeyOf(d),
    weekday: d.toLocaleDateString("tr-TR", { weekday: "short" }),
    dayNum: d.getDate(),
    isToday: sameDay(d, today),
    longLabel: d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" }),
  }));

  const rangeLabel =
    mode === "hafta"
      ? `${dates[0]!.toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} – ${dates[6]!.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}`
      : date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" });

  const navBtn =
    "focus-ring grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:bg-canvas touch:min-h-11 touch:min-w-11";

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-ink-950">{rangeLabel}</h2>
        <div className="flex items-center gap-1">
          <Link href={prevHref} className={navBtn} aria-label={mode === "hafta" ? "Önceki hafta" : "Önceki gün"}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={todayHref}
            className="focus-ring inline-flex items-center rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold text-text-muted transition hover:bg-canvas touch:min-h-11"
          >
            Bugün
          </Link>
          <Link href={nextHref} className={navBtn} aria-label={mode === "hafta" ? "Sonraki hafta" : "Sonraki gün"}>
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Mobil: tek akış ajanda (yatay kaydırma yok). */}
      <div className="mt-4 sm:hidden">
        <AgendaList
          mode={mode}
          days={days}
          appointments={appointments}
          tasks={tasks}
          dayHref={dayHref}
          newHref={newHref}
          nowMs={now()}
        />
      </div>

      {/* ≥640 px: saat ızgarası (sürükle-bırak). */}
      <div className="mt-4 hidden sm:block">
        <WeekGrid
          mode={mode}
          days={days}
          appointments={appointments}
          tasks={tasks}
          newHref={newHref}
          canEdit={canEdit}
          canEditTasks={canEditTasks}
        />
      </div>

      {/* Lejant */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {Object.entries(TYPE_LABEL).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${TYPE_COLOR[key]}`} /> {label}
          </span>
        ))}
        {tasks.length > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="h-2.5 w-2.5 rounded-sm border border-amber-500/60 bg-amber-400/30" /> Saatli görev
          </span>
        ) : null}
        {canEdit ? (
          <span className="hidden text-xs text-text-faint sm:inline">Randevuyu sürükleyerek taşıyın; alt kenarından süreyi değiştirin.</span>
        ) : null}
      </div>
    </section>
  );
}
