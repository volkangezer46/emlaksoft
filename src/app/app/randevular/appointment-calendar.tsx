"use client";

import { useState } from "react";
import { ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";

type AppointmentItem = {
  id: string;
  scheduled_at: string;
  appointment_type: string;
  status: string;
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

const TR_MONTHS = [
  "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
  "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"
];
const TR_DAYS_SHORT = ["Pt","Sa","Ça","Pe","Cu","Ct","Pz"];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

export function AppointmentCalendar({ appointments }: { appointments: AppointmentItem[] }) {
  const today = new Date();
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date | null>(today);

  function prevMonth() {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  // Grid hesapla
  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  // Pazartesi başlangıç — getDay() 0=Pazar, adjust
  const startOffset = (firstDay.getDay() + 6) % 7; // 0=Pt, 6=Pz
  const totalCells  = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

  const cells: (Date | null)[] = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > lastDay.getDate()) return null;
    return new Date(year, month, dayNum);
  });

  const selectedAppts = selected
    ? appointments.filter((a) => sameDay(new Date(a.scheduled_at), selected))
    : [];

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      {/* Başlık */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-bold text-ink-950">
          {TR_MONTHS[month]} {year}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            className="grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:bg-canvas"
            aria-label="Önceki ay"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="rounded-[8px] border border-line px-2.5 py-1 text-[11px] font-semibold text-text-muted transition hover:bg-canvas"
          >
            Bugün
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="grid h-8 w-8 place-items-center rounded-[8px] border border-line text-text-muted transition hover:bg-canvas"
            aria-label="Sonraki ay"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Gün başlıkları */}
      <div className="mt-3 grid grid-cols-7 gap-px text-center">
        {TR_DAYS_SHORT.map((d) => (
          <div key={d} className="py-1.5 text-[11px] font-bold text-text-faint">{d}</div>
        ))}
      </div>

      {/* Takvim grid */}
      <div className="mt-1 grid grid-cols-7 gap-px">
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="h-10" />;
          const isToday    = sameDay(cell, today);
          const isSelected = selected ? sameDay(cell, selected) : false;
          const dayAppts   = appointments.filter((a) => sameDay(new Date(a.scheduled_at), cell));
          const isPast     = cell < new Date(today.getFullYear(), today.getMonth(), today.getDate());

          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(cell)}
              className={`relative flex h-10 flex-col items-center justify-center rounded-[8px] text-sm transition
                ${isSelected  ? "bg-brand-600 text-white font-bold" :
                  isToday     ? "border border-brand-400/50 font-bold text-brand-600" :
                  isPast      ? "text-text-faint hover:bg-canvas/60" :
                                "text-ink-950 hover:bg-canvas"}
              `}
            >
              {cell.getDate()}
              {dayAppts.length > 0 && (
                <span className={`absolute bottom-1 flex gap-0.5 ${isSelected ? "opacity-80" : ""}`}>
                  {dayAppts.slice(0, 3).map((a, j) => (
                    <span
                      key={j}
                      className={`h-1.5 w-1.5 rounded-full ${isSelected ? "bg-white" : (TYPE_COLOR[a.appointment_type] ?? "bg-brand-600")}`}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Seçilen günün randevuları */}
      {selected && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-xs font-semibold text-text-muted">
            {selected.toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" })}
            {" — "}{selectedAppts.length} randevu
          </p>
          {selectedAppts.length === 0 ? (
            <p className="text-xs text-text-faint">Bu gün randevu yok.</p>
          ) : (
            <div className="space-y-1.5">
              {/* Çapa: listedeki karta kaydırır (kart id'si `randevu-{id}`) */}
              {selectedAppts.map((a) => (
                <a
                  key={a.id}
                  href={`#randevu-${a.id}`}
                  className="focus-ring group flex items-center gap-2 rounded-[10px] border border-line bg-canvas/60 px-3 py-2 transition hover:border-brand-300 hover:bg-canvas"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_COLOR[a.appointment_type] ?? "bg-brand-600"}`} />
                  <span className="text-xs font-semibold text-ink-950">
                    {new Date(a.scheduled_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-xs text-text-muted">{TYPE_LABEL[a.appointment_type] ?? a.appointment_type}</span>
                  <ArrowDown className="hover-action ml-auto h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
