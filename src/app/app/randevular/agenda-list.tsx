import Link from "@/components/ui/smart-link";
import { CheckSquare, Plus } from "lucide-react";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { formatTrTime, trDayKey } from "@/lib/clock";
import type { WeekGridDay, WeekViewAppointment, WeekViewTask } from "./week-grid";

const TYPE_DOT: Record<string, string> = {
  showing: "bg-brand-600",
  office: "bg-cyan-500",
  valuation: "bg-amber-500",
  contract: "bg-mint-500",
};

type Item =
  | { kind: "appt"; at: string; appt: WeekViewAppointment }
  | { kind: "task"; at: string; task: WeekViewTask };

/**
 * GA-03 mobil ajanda (<640 px; sunucu bileşeni): hafta/gün saat ızgarası yerine randevular ve saatli görevler TEK
 * akışta, saat sırasıyla. Hafta görünümünde üstte 7 günlük şerit (sayılı, dokununca o günün ajandası). Bugünde "Şimdi"
 * çizgisi; boş günde "+ Randevu ekle". Her satır kaydın kendisini açar (`?randevu=` / `?gorev=`).
 */
export function AgendaList({
  mode,
  days,
  appointments,
  tasks,
  dayHref,
  newHref,
  nowMs,
}: {
  mode: "hafta" | "gun";
  days: WeekGridDay[];
  appointments: WeekViewAppointment[];
  tasks: WeekViewTask[];
  dayHref: (dayKey: string) => string;
  newHref: string | null;
  nowMs: number;
}) {
  const itemsByDay = new Map<string, Item[]>();
  for (const a of appointments) {
    const k = trDayKey(a.scheduled_at);
    itemsByDay.set(k, [...(itemsByDay.get(k) ?? []), { kind: "appt", at: a.scheduled_at, appt: a }]);
  }
  for (const t of tasks) {
    const k = trDayKey(t.due_at);
    itemsByDay.set(k, [...(itemsByDay.get(k) ?? []), { kind: "task", at: t.due_at, task: t }]);
  }
  const nowIso = new Date(nowMs).toISOString();

  return (
    <div className="space-y-3">
      {mode === "hafta" ? (
        <nav aria-label="Haftanın günleri" className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const count = itemsByDay.get(d.key)?.length ?? 0;
            return (
              <Link
                key={d.key}
                href={dayHref(d.key)}
                aria-label={`${d.longLabel}: ${count} kayıt`}
                className={`focus-ring flex min-h-14 flex-col items-center justify-center rounded-[var(--radius-control)] border text-center transition ${
                  d.isToday ? "border-brand-400 bg-brand-600/8" : "border-line bg-canvas hover:border-brand-300"
                }`}
              >
                <span className={`text-[11px] font-bold uppercase ${d.isToday ? "text-brand-700" : "text-text-faint"}`}>{d.weekday}</span>
                <span className="font-display text-base font-extrabold text-ink-950">{d.dayNum}</span>
                <span className={`numeric h-4 text-[10px] font-bold ${count ? "text-brand-700" : "text-transparent"}`}>{count || "0"}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {days.map((d) => {
        const items = [...(itemsByDay.get(d.key) ?? [])].sort((a, b) => a.at.localeCompare(b.at));
        if (mode === "hafta" && items.length === 0) return null;
        const nowIndex = d.isToday ? items.findIndex((i) => i.at > nowIso) : -1;
        return (
          <section key={d.key} aria-label={d.longLabel}>
            {mode === "hafta" ? (
              <h3 className={`mb-1.5 text-xs font-bold uppercase tracking-wide ${d.isToday ? "text-brand-700" : "text-text-muted"}`}>
                {d.isToday ? `Bugün · ${d.longLabel}` : d.longLabel}
              </h3>
            ) : null}
            {items.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
                Bu gün için randevu ya da saatli görev yok.
                {newHref ? (
                  <Link
                    href={`${newHref}${newHref.includes("?") ? "&" : "?"}tarih=${d.key}`}
                    className="focus-ring mx-auto mt-3 flex min-h-11 w-fit items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-4 text-sm font-semibold text-brand-700"
                  >
                    <Plus className="h-4 w-4" aria-hidden /> Randevu ekle
                  </Link>
                ) : null}
              </div>
            ) : (
              <ol className="space-y-1.5">
                {items.map((item, i) => (
                  <li key={`${item.kind}-${item.kind === "appt" ? item.appt.id : item.task.id}`}>
                    {i === nowIndex ? <NowLine /> : null}
                    {item.kind === "appt" ? <ApptRow a={item.appt} /> : <TaskRow t={item.task} />}
                  </li>
                ))}
                {d.isToday && nowIndex === -1 ? (
                  <li>
                    <NowLine />
                  </li>
                ) : null}
              </ol>
            )}
          </section>
        );
      })}
      {mode === "hafta" && appointments.length === 0 && tasks.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-6 text-center text-sm text-text-muted">
          Bu hafta randevu ya da saatli görev yok.
        </p>
      ) : null}
    </div>
  );
}

function NowLine() {
  return (
    <div className="my-1 flex items-center gap-2" aria-label="Şimdi">
      <span className="h-2 w-2 rounded-full bg-danger-500" aria-hidden />
      <span className="h-px flex-1 bg-danger-500/60" aria-hidden />
      <span className="text-[11px] font-bold text-danger-600">Şimdi</span>
    </div>
  );
}

function ApptRow({ a }: { a: WeekViewAppointment }) {
  const type = APPOINTMENT_TYPE_LABELS[a.appointment_type] ?? a.appointment_type;
  return (
    <Link
      href={`/app/randevular?randevu=${a.id}`}
      prefetch={false}
      className={`focus-ring flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 transition hover:border-brand-300 ${
        a.status === "completed" ? "opacity-70" : ""
      }`}
    >
      <span className="numeric w-11 shrink-0 text-sm font-bold text-ink-950">{formatTrTime(a.scheduled_at)}</span>
      <span className={`h-8 w-1 shrink-0 rounded-full ${TYPE_DOT[a.appointment_type] ?? "bg-brand-600"}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-950">{a.customerName ?? type}</span>
        <span className="block truncate text-xs text-text-muted">
          {type}
          {a.propertyName || a.location ? ` · ${a.propertyName ?? a.location}` : ""}
          {a.duration_min ? ` · ${a.duration_min} dk` : ""}
        </span>
      </span>
    </Link>
  );
}

function TaskRow({ t }: { t: WeekViewTask }) {
  return (
    <Link
      href={`/app/gorevler?gorev=${t.id}`}
      prefetch={false}
      className="focus-ring flex min-h-12 items-center gap-3 rounded-[var(--radius-card)] border border-amber-500/40 bg-amber-400/10 px-3 py-2 transition hover:border-amber-500/70"
    >
      <span className="numeric w-11 shrink-0 text-sm font-bold text-ink-950">{formatTrTime(t.due_at)}</span>
      <CheckSquare className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-950">{t.title}</span>
        <span className="block truncate text-xs text-text-muted">Görev{t.customerName ? ` · ${t.customerName}` : ""}</span>
      </span>
    </Link>
  );
}
