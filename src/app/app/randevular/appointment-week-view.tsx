import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Hafta / gün görünümü — ?gorunum=hafta|gun (ay: mevcut AppointmentCalendar).
 *
 * Sunucu bileşeni: gezinme ?tarih= linkleriyle yapılır (prev/next/bugün hrefleri
 * sayfada hesaplanır). Randevu blokları listedeki karta (#randevu-{id}) kayan
 * çapa linkleridir — takvimdeki mevcut desenle aynı.
 */

export type WeekViewAppointment = {
  id: string;
  scheduled_at: string;
  duration_min: number | null;
  appointment_type: string;
  status: string;
  customerName: string | null;
  propertyName: string | null;
  location: string | null;
};

const TYPE_COLOR: Record<string, string> = {
  showing:   "bg-brand-600",
  office:    "bg-cyan-500",
  valuation: "bg-amber-500",
  contract:  "bg-mint-500",
};

const TYPE_LABEL: Record<string, string> = {
  showing:   "Yer gösterme",
  office:    "Ofis görüşmesi",
  valuation: "Değerleme",
  contract:  "Sözleşme",
};

// Saat ızgarası: 07:00–21:00
const HOUR_START = 7;
const HOUR_END = 21;
const HOUR_PX = 48; // 1 saat = 48px
const GRID_H = (HOUR_END - HOUR_START) * HOUR_PX;

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 07:00 öncesi/21:00 sonrası taşan bloklar ızgara sınırına kırpılır. */
function blockPos(start: Date, durationMin: number | null) {
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = startMin + (durationMin ?? 60);
  const lo = HOUR_START * 60;
  const hi = HOUR_END * 60;
  const clampedStart = Math.max(lo, Math.min(startMin, hi - 15));
  const clampedEnd = Math.max(clampedStart + 15, Math.min(endMin, hi));
  return {
    top: ((clampedStart - lo) / 60) * HOUR_PX,
    height: Math.max(20, ((clampedEnd - clampedStart) / 60) * HOUR_PX),
  };
}

function timeLabel(d: Date) {
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export function AppointmentWeekView({
  mode,
  date,
  appointments,
  prevHref,
  nextHref,
  todayHref,
}: {
  mode: "hafta" | "gun";
  /** Seçili gün (yerel saat, gün başı). */
  date: Date;
  appointments: WeekViewAppointment[];
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  const today = new Date();

  // Hafta: seçili günü içeren Pazartesi–Pazar; gün: tek kolon.
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const days: Date[] =
    mode === "hafta"
      ? Array.from({ length: 7 }, (_, i) => {
          const d = new Date(weekStart);
          d.setDate(weekStart.getDate() + i);
          return d;
        })
      : [date];

  const rangeLabel =
    mode === "hafta"
      ? `${days[0].toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" })}`
      : date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long" });

  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-ink-950">{rangeLabel}</h2>
        <div className="flex items-center gap-1">
          <Link
            href={prevHref}
            className="grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:bg-canvas"
            aria-label={mode === "hafta" ? "Önceki hafta" : "Önceki gün"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={todayHref}
            className="rounded-[8px] border border-line px-2.5 py-1 text-[11px] font-semibold text-text-muted transition hover:bg-canvas"
          >
            Bugün
          </Link>
          <Link
            href={nextHref}
            className="grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:bg-canvas"
            aria-label={mode === "hafta" ? "Sonraki hafta" : "Sonraki gün"}
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className={mode === "hafta" ? "min-w-[760px]" : ""}>
          {/* Gün başlıkları */}
          <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
            {/* Dar ekranda yatay kaydırmada saat kolonu sabit kalsın */}
            <div className="sticky left-0 z-10 bg-surface" />
            {days.map((d, i) => {
              const isToday = sameDay(d, today);
              return (
                <div key={i} className="border-b border-line px-2 pb-2 text-center">
                  <p className={`text-[11px] font-bold uppercase ${isToday ? "text-brand-600" : "text-text-faint"}`}>
                    {d.toLocaleDateString("tr-TR", { weekday: "short" })}
                  </p>
                  <p className={`font-display text-lg font-extrabold ${isToday ? "text-brand-600" : "text-ink-950"}`}>
                    {d.getDate()}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Saat ızgarası + randevu blokları */}
          <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days.length}, 1fr)` }}>
            {/* Saat etiketleri — yatay kaydırmada sabit ilk kolon */}
            <div className="sticky left-0 z-10 bg-surface" style={{ height: GRID_H }}>
              {hours.map((h) => (
                <span
                  key={h}
                  className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-text-faint"
                  style={{ top: (h - HOUR_START) * HOUR_PX }}
                >
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
            </div>

            {days.map((d, i) => {
              const dayAppts = appointments
                .filter((a) => sameDay(new Date(a.scheduled_at), d))
                .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
              return (
                <div key={i} className="relative border-l border-line" style={{ height: GRID_H }}>
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-line/60"
                      style={{ top: (h - HOUR_START) * HOUR_PX }}
                      aria-hidden
                    />
                  ))}
                  {dayAppts.map((a) => {
                    const start = new Date(a.scheduled_at);
                    const { top, height } = blockPos(start, a.duration_min);
                    const color = TYPE_COLOR[a.appointment_type] ?? "bg-brand-600";
                    const cancelled = a.status === "cancelled";
                    return (
                      // Çapa: listedeki karta kaydırır (kart id'si `randevu-{id}`)
                      <a
                        key={a.id}
                        href={`#randevu-${a.id}`}
                        title={`${timeLabel(start)} · ${TYPE_LABEL[a.appointment_type] ?? a.appointment_type}${a.customerName ? ` · ${a.customerName}` : ""}`}
                        className={`focus-ring absolute inset-x-1 overflow-hidden rounded-[8px] ${color} px-1.5 py-1 text-white transition hover:brightness-110 ${cancelled ? "opacity-50" : ""}`}
                        style={{ top, height }}
                      >
                        <p className="truncate text-[10px] font-bold leading-tight">
                          {timeLabel(start)}
                          {mode === "gun" ? ` · ${TYPE_LABEL[a.appointment_type] ?? a.appointment_type}` : ""}
                        </p>
                        {height >= 32 ? (
                          <p className="truncate text-[10px] leading-tight opacity-90">
                            {a.customerName ?? TYPE_LABEL[a.appointment_type] ?? ""}
                          </p>
                        ) : null}
                        {mode === "gun" && height >= 48 ? (
                          <p className="truncate text-[10px] leading-tight opacity-75">
                            {a.propertyName ?? a.location ?? ""}
                          </p>
                        ) : null}
                      </a>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Lejant */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {Object.entries(TYPE_LABEL).map(([key, label]) => (
          <span key={key} className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${TYPE_COLOR[key]}`} /> {label}
          </span>
        ))}
      </div>
    </section>
  );
}
