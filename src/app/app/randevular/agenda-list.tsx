import Link from "@/components/ui/smart-link";
import { CheckSquare, ChevronDown } from "lucide-react";
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { ICONS } from "@/lib/icons";
import { StatusPill } from "@/components/ui/list-kit/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { APPOINTMENT_STATUS_LABELS, appointmentStatusTone } from "./appointment-list-logic";
import { formatTrTime, trDayKey } from "@/lib/clock";
import type { WeekGridDay, WeekViewAppointment, WeekViewTask } from "./week-grid";
import { ApptSwipe, TaskSwipe } from "./agenda-swipe";

/** Tür ikonu karosu (referans "Bugünkü randevularım": saat · renkli çizgi · tür karosu · ad + alt satır · durum hapı). */
const TYPE_ICON = {
  showing: { Icon: ICONS.yerGosterme, cls: "bg-brand-600/10 text-brand-600" },
  office: { Icon: ICONS.musteri, cls: "bg-cyan-500/12 text-cyan-700" },
  valuation: { Icon: ICONS.degerleme, cls: "bg-amber-400/15 text-amber-700" },
  contract: { Icon: ICONS.imza, cls: "bg-mint-500/12 text-mint-700" },
} as const;

const TYPE_DOT: Record<string, string> = {
  showing: "bg-brand-600",
  office: "bg-cyan-500",
  valuation: "bg-amber-500",
  contract: "bg-mint-500",
};

type Item =
  | { kind: "appt"; at: string; appt: WeekViewAppointment }
  | { kind: "task"; at: string; task: WeekViewTask };

type Entry = Item | { kind: "taskGroup"; at: string; tasks: WeekViewTask[] };

/** Bir günde bu sayıdan fazla saatli görev varsa görevler tek katlanır grupta toplanır; randevular akışta görünür kalır. */
export const AGENDA_TASK_GROUP_MIN = 4;

/** Gün öğelerini (saat sıralı) akış girdilerine çevirir: çok görevli günde görevler ilk görevin yerinde tek grup olur. */
export function buildAgendaEntries(items: Item[]): Entry[] {
  const tasks = items.filter((i): i is Extract<Item, { kind: "task" }> => i.kind === "task");
  if (tasks.length < AGENDA_TASK_GROUP_MIN) return items;
  const out: Entry[] = [];
  let placed = false;
  for (const i of items) {
    if (i.kind === "appt") out.push(i);
    else if (!placed) {
      out.push({ kind: "taskGroup", at: i.at, tasks: tasks.map((t) => t.task) });
      placed = true;
    }
  }
  return out;
}

/**
 * GA-03 mobil ajanda (<640 px; sunucu bileşeni): hafta/gün saat ızgarası yerine randevular ve saatli görevler TEK
 * akışta, saat sırasıyla. Hafta görünümünde üstte 7 günlük şerit (sayılı, dokununca o günün ajandası). Bugünde "Şimdi"
 * çizgisi; boş günde "+ Randevu ekle". Her satır kaydın kendisini açar (`?randevu=` / `?gorev=`). GA-10: dokunmatikte
 * satır kaydırılır (randevu: sağa tamamla / sola teyit; görev: sağa tamamla / sola yarın).
 * `liste` (sadeleştirme C18, sade modun varsayılanı): şerit yok; her gün (Bugün, Yarın) başlığıyla, boş gün de gösterilir.
 */
export function AgendaList({
  mode,
  days,
  appointments,
  tasks,
  dayHref,
  newHref,
  nowMs,
  canEdit = false,
  canEditTasks = false,
}: {
  mode: "hafta" | "gun" | "liste";
  days: WeekGridDay[];
  appointments: WeekViewAppointment[];
  tasks: WeekViewTask[];
  dayHref: (dayKey: string) => string;
  newHref: string | null;
  nowMs: number;
  canEdit?: boolean;
  canEditTasks?: boolean;
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
                <span className={`text-xs font-bold uppercase ${d.isToday ? "text-brand-700" : "text-text-faint"}`}>{d.weekday}</span>
                <span className="font-display text-base font-extrabold text-ink-950">{d.dayNum}</span>
                <span className={`numeric h-4 text-xs font-bold ${count ? "text-brand-700" : "text-transparent"}`}>{count || "0"}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}

      {days.map((d) => {
        const items = [...(itemsByDay.get(d.key) ?? [])].sort((a, b) => a.at.localeCompare(b.at));
        if (mode === "hafta" && items.length === 0) return null;
        const entries = buildAgendaEntries(items);
        const nowIndex = d.isToday ? entries.findIndex((i) => i.at > nowIso) : -1;
        return (
          <section key={d.key} aria-label={d.longLabel}>
            {mode === "hafta" ? (
              <h3 className={`mb-1.5 text-xs font-bold uppercase tracking-wide ${d.isToday ? "text-brand-700" : "text-text-muted"}`}>
                {d.isToday ? `Bugün · ${d.longLabel}` : d.longLabel}
              </h3>
            ) : mode === "liste" ? (
              <h3 className={`mb-2 font-display text-base font-bold ${d.isToday ? "text-brand-700" : "text-ink-950"}`}>
                {d.label ?? d.longLabel} <span className="text-sm font-medium text-text-muted">· {d.longLabel}</span>
              </h3>
            ) : null}
            {items.length === 0 && mode !== "liste" ? (
              // Haftalık görünümde boş gün tek satır (7 ayrı boş durum kartı çizilmez; hafta boşsa aşağıda tek boş durum).
              <p className="px-1 py-1.5 text-xs text-text-faint">Randevu yok</p>
            ) : items.length === 0 ? (
              // Ortak boş durum (WP3): çizimli, tek eylemli; düz kesikli kutu yok.
              <EmptyState
                variant="compact"
                illustration="randevu"
                icon={ICONS.randevu}
                title="Bu gün için randevu yok"
                description="Saatli görev de yok. Boş saatleri yer gösterme ya da arama için kullanabilirsiniz."
                action={newHref ? { href: `${newHref}${newHref.includes("?") ? "&" : "?"}tarih=${d.key}`, label: "Randevu ekle" } : undefined}
              />
            ) : (
              <ol className="space-y-1.5">
                {entries.map((item, i) => (
                  <li key={item.kind === "appt" ? `appt-${item.appt.id}` : item.kind === "task" ? `task-${item.task.id}` : "task-group"}>
                    {i === nowIndex ? <NowLine /> : null}
                    {item.kind === "taskGroup" ? (
                      <TaskGroup tasks={item.tasks} canEdit={canEditTasks} />
                    ) : item.kind === "appt" ? (
                      <ApptSwipe
                        id={item.appt.id}
                        canComplete={canEdit && item.appt.status !== "completed" && item.appt.status !== "cancelled"}
                        waHref={item.appt.confirmWaHref ?? null}
                      >
                        <ApptRow a={item.appt} />
                      </ApptSwipe>
                    ) : (
                      <TaskSwipe id={item.task.id} canEdit={canEditTasks}>
                        <TaskRow t={item.task} />
                      </TaskSwipe>
                    )}
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
        <EmptyState variant="compact" illustration="randevu" icon={ICONS.randevu} title="Bu hafta randevu yok" description="Bu hafta için saatli görev de yok." action={newHref ? { href: newHref, label: "Randevu ekle" } : undefined} />
      ) : null}
    </div>
  );
}

function NowLine() {
  return (
    <div className="my-1 flex items-center gap-2" aria-label="Şimdi">
      <span className="h-2 w-2 rounded-full bg-danger-500" aria-hidden />
      <span className="h-px flex-1 bg-danger-500/60" aria-hidden />
      <span className="text-xs font-bold text-danger-600">Şimdi</span>
    </div>
  );
}

function ApptRow({ a }: { a: WeekViewAppointment }) {
  const type = APPOINTMENT_TYPE_LABELS[a.appointment_type] ?? a.appointment_type;
  const ti = TYPE_ICON[a.appointment_type as keyof typeof TYPE_ICON] ?? TYPE_ICON.showing;
  const statusLabel = APPOINTMENT_STATUS_LABELS[a.status];
  return (
    <Link
      href={`/app/randevular?randevu=${a.id}`}
      prefetch={false}
      className={`focus-ring flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2 transition hover:border-brand-300 hover:bg-surface-hover ${
        a.status === "completed" ? "opacity-70" : ""
      }`}
    >
      <span className="numeric w-11 shrink-0 text-sm font-bold text-ink-950">{formatTrTime(a.scheduled_at)}</span>
      <span className={`h-8 w-1 shrink-0 rounded-full ${TYPE_DOT[a.appointment_type] ?? "bg-brand-600"}`} aria-hidden />
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] ${ti.cls}`} aria-hidden>
        <ti.Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-950">{a.customerName ?? type}</span>
        <span className="block truncate text-xs text-text-muted">
          {type}
          {a.propertyName || a.location ? ` · ${a.propertyName ?? a.location}` : ""}
          {a.duration_min ? ` · ${a.duration_min} dk` : ""}
        </span>
      </span>
      {statusLabel ? (
        <StatusPill tone={appointmentStatusTone(a.status)} className="hidden shrink-0 min-[400px]:inline-flex">
          {statusLabel}
        </StatusPill>
      ) : null}
    </Link>
  );
}

function TaskGroup({ tasks, canEdit }: { tasks: WeekViewTask[]; canEdit: boolean }) {
  const first = tasks[0];
  const last = tasks[tasks.length - 1];
  return (
    <details className="group rounded-[var(--radius-card)] border border-amber-500/40 bg-amber-400/10">
      <summary className="focus-ring flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-[var(--radius-card)] px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="numeric w-11 shrink-0 text-sm font-bold text-ink-950">{formatTrTime(first.due_at)}</span>
        <CheckSquare className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-950">{tasks.length} saatli görev</span>
          <span className="block truncate text-xs text-text-muted">
            {formatTrTime(first.due_at)}–{formatTrTime(last.due_at)} arası · listeyi açmak için dokunun
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <ol className="space-y-1.5 px-2 pb-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <TaskSwipe id={t.id} canEdit={canEdit}>
              <TaskRow t={t} />
            </TaskSwipe>
          </li>
        ))}
      </ol>
    </details>
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
