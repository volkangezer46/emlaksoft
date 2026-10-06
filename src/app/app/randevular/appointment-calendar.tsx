"use client";

import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { useState } from "react";
import { trDayKey, formatTrTime } from "@/lib/clock";
import Link from "next/link";
import { ArrowDown, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";

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

const TYPE_LABEL = APPOINTMENT_TYPE_LABELS;

const TR_MONTHS = [
  "Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
  "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"
];
const TR_DAYS_SHORT = ["Pt","Sa","Ça","Pe","Cu","Ct","Pz"];

const TR_DAYS_LONG = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

/**
 * Hidrasyon güvenliği: bileşen içinde `new Date()` / yerel saat dilimi YOK.
 * "Bugün" sunucudan (TR günü, `todayKey`) gelir; randevuların günü TR saatine
 * göre hesaplanır; tüm tarih/saat metinleri saat diliminden bağımsız üretilir.
 * Sunucu (UTC) ile tarayıcı (TR) aynı çıktıyı verir → React #418 oluşmaz.
 */
export function AppointmentCalendar({
  appointments,
  todayKey,
  newHref = null,
}: {
  appointments: AppointmentItem[];
  /** Sunucudaki TR bugünü, "YYYY-MM-DD". */
  todayKey: string;
  /** Randevu oluşturma yetkisi varsa yeni randevu sayfası adresi (ön seçim paramlı ya da düz); yoksa null. */
  newHref?: string | null;
}) {
  const [ty, tm] = todayKey.split("-").map(Number);
  const [view, setView] = useState({ year: ty, month: tm - 1 });
  const [selected, setSelected] = useState<string | null>(todayKey);

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(Date.UTC(v.year, v.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  // Randevuları TR gün anahtarına göre bir kez grupla
  const byDay = new Map<string, AppointmentItem[]>();
  for (const a of appointments) {
    const k = trDayKey(a.scheduled_at);
    const list = byDay.get(k);
    if (list) list.push(a);
    else byDay.set(k, [a]);
  }

  // Grid hesapla
  const { year, month } = view;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // Pazartesi başlangıç — getUTCDay() 0=Pazar, adjust
  const startOffset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // 0=Pt, 6=Pz
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells: (string | null)[] = Array.from({ length: totalCells }, (_, i) => {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) return null;
    return keyOf(year, month, dayNum);
  });

  const selectedAppts = selected ? byDay.get(selected) ?? [] : [];
  let selectedLabel = "";
  if (selected) {
    const [sy, sm, sd] = selected.split("-").map(Number);
    const wd = new Date(Date.UTC(sy, sm - 1, sd)).getUTCDay();
    selectedLabel = `${sd} ${TR_MONTHS[sm - 1]} ${TR_DAYS_LONG[wd]}`;
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      {/* Başlık */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-bold text-ink-950">
          {TR_MONTHS[month]} {year}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:bg-canvas"
            aria-label="Önceki ay"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView({ year: ty, month: tm - 1 })}
            className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold text-text-muted transition hover:bg-canvas"
          >
            Bugün
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted transition hover:bg-canvas"
            aria-label="Sonraki ay"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Gün başlıkları */}
      <div className="mt-3 grid grid-cols-7 gap-px text-center">
        {TR_DAYS_SHORT.map((d) => (
          <div key={d} className="py-1.5 text-xs font-bold text-text-faint">{d}</div>
        ))}
      </div>

      {/* Takvim grid */}
      <div className="mt-1 grid grid-cols-7 gap-px">
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="h-10" />;
          const isToday    = cell === todayKey;
          const isSelected = selected === cell;
          const dayAppts   = byDay.get(cell) ?? [];
          const isPast     = cell < todayKey;

          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(cell)}
              className={`relative flex h-10 flex-col items-center justify-center rounded-[var(--radius-control)] text-sm transition
                ${isSelected  ? "bg-brand-600 text-white font-bold" :
                  isToday     ? "border border-brand-400/50 font-bold text-brand-600" :
                  isPast      ? "text-text-faint hover:bg-canvas/60" :
                                "text-ink-950 hover:bg-canvas"}
              `}
            >
              {Number(cell.slice(8))}
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
            {selectedLabel}
            {" — "}{selectedAppts.length} randevu
          </p>
          {newHref ? (
            <Link
              href={`${newHref}${newHref.includes("?") ? "&" : "?"}tarih=${selected}`}
              className="focus-ring mb-2 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300 hover:bg-canvas"
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Bu güne randevu ekle
            </Link>
          ) : null}
          {selectedAppts.length === 0 ? (
            <p className="text-xs text-text-faint">Bu gün randevu yok.</p>
          ) : (
            <div className="space-y-1.5">
              {/* Çapa: listedeki karta kaydırır (kart id'si `randevu-{id}`) */}
              {selectedAppts.map((a) => (
                <a
                  key={a.id}
                  href={`#randevu-${a.id}`}
                  className="focus-ring group flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas/60 px-3 py-2 transition hover:border-brand-300 hover:bg-canvas"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_COLOR[a.appointment_type] ?? "bg-brand-600"}`} />
                  <span className="text-xs font-semibold text-ink-950">
                    {formatTrTime(a.scheduled_at)}
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
