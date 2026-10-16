import Link from "@/components/ui/smart-link";
import { CalendarDays, ListTodo, Navigation, Phone, ArrowRight } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTrTime } from "@/lib/clock";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { appointmentHref, taskHref } from "@/lib/notification-text";
import { directionsHref } from "@/lib/route-plan";
import { OVERDUE_TASKS_HREF } from "@/lib/nav-badges";
import { loadHotLeads, loadOverdueTasks, loadTodayAppointments, type HomeCtx } from "./data";
import { buildCallRows } from "./home-brief";
import { loadInsightBundle } from "./insight-veri";
import { BittiDugmesi } from "./bitti-dugmesi";
import { buildBugunum, bugunumRowCount, type BugunumGroup, type BugunumGroupId, type BugunumRow } from "./bugunum-core";

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));

const GROUP_ICON: Record<BugunumGroupId, typeof Phone> = { randevu: CalendarDays, ara: Phone, gorev: ListTodo };

export function BugunumIskelet() {
  return (
    <div role="status" aria-busy="true" className="ds-card ds-pad flex min-h-[20rem] flex-col gap-2">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/**
 * DANIŞMAN "BUGÜNÜM" (sadeleştirme planı 2.4 / C07): tek sütunlu, sıralı tek liste — bugünkü randevular → aranacaklar →
 * gecikmiş görevler. Her satırda TEK, 44 px eylem (Yol tarifi / Ara / Bitti); satır metni kaydın kendisine gider.
 * Gecikmiş görev sayısı alt çubuk rozetiyle AYNI tanımdan (`loadOverdueTasks` → `overdueTasksCountQuery`).
 * Kurgu saf `bugunum-core.ts`'te (tavanlar, sıra, eylem seçimi; vitest).
 */
export async function Bugunum({ ctx }: { ctx: HomeCtx }) {
  const canAppt = (ctx.perms.appointments ?? []).includes("view");
  const canCustomers = (ctx.perms.customers ?? []).includes("view");
  const [appts, hot, bundle, overdue] = await Promise.all([
    canAppt ? loadTodayAppointments(ctx).catch(() => ({ rows: [], total: 0 })) : Promise.resolve({ rows: [], total: 0 }),
    canCustomers ? loadHotLeads(ctx).catch(() => []) : Promise.resolve([]),
    loadInsightBundle(ctx).catch(() => ({ insights: [], total: 0 })),
    loadOverdueTasks(ctx).catch(() => ({ count: null, rows: [] })),
  ]);
  const calls = buildCallRows(
    hot.map((h) => ({ id: h.id, fullName: h.fullName, phone: h.phone, reasons: h.reasons })),
    bundle.insights,
    6,
  );
  const groups = buildBugunum({
    appts: appts.rows.map((a) => {
      const cust = one(a.customer as Rel<{ full_name?: string | null; phone?: string | null }>);
      const prop = one(a.property as Rel<{ lat?: number | null; lng?: number | null }>);
      return {
        id: a.id,
        at: Date.parse(a.scheduled_at),
        time: formatTrTime(a.scheduled_at),
        type: appointmentTypeLabel(a.appointment_type),
        customer: cust?.full_name ?? null,
        phone: cust?.phone ?? null,
        directions: directionsHref({ lat: prop?.lat ?? null, lng: prop?.lng ?? null, location: a.location }),
        pending: a.status === "pending",
      };
    }),
    apptTotal: appts.total,
    calls,
    tasks: overdue.rows,
    overdueCount: overdue.count,
    overdueHref: OVERDUE_TASKS_HREF,
    dayStartMs: Date.parse(ctx.dayStartIso),
    apptHref: appointmentHref,
    taskHref,
  });

  return (
    <section aria-labelledby="bugunum-baslik" className="ds-card ds-pad flex flex-col gap-3" data-tour="brifing">
      <h2 id="bugunum-baslik" className="ds-title">
        Bugünüm
      </h2>
      {bugunumRowCount(groups) === 0 ? (
        <EmptyState
          variant="compact"
          illustration="gorev"
          tone="mint"
          title="Bugün için bekleyen iş yok"
          description="Randevu, aranacak müşteri ya da gecikmiş görev oluştukça burada sırayla görünür."
          action={canAppt ? { href: "/app/randevular/yeni", label: "Randevu ver" } : undefined}
        />
      ) : (
        groups.map((g) => <Grup key={g.id} g={g} />)
      )}
    </section>
  );
}

function Grup({ g }: { g: BugunumGroup }) {
  const Icon = GROUP_ICON[g.id];
  return (
    <div className="flex flex-col" data-bugunum-grup={g.id}>
      <div className="flex min-h-8 items-center gap-2 px-1">
        <Icon className="h-4 w-4 text-text-muted" aria-hidden="true" />
        <h3 className="flex-1 text-sm font-semibold text-text-muted">
          {g.title} <span className="tabular-nums">({g.total})</span>
        </h3>
        {g.moreHref ? (
          <Link href={g.moreHref} className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-[var(--accent-text)]">
            Tümü <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <ul className="divide-y divide-line">
        {g.rows.map((r) => (
          <Satir key={r.key} r={r} />
        ))}
      </ul>
    </div>
  );
}

function Satir({ r }: { r: BugunumRow }) {
  const body = (
    <>
      {r.lead ? (
        <span className={`w-12 shrink-0 text-sm font-bold tabular-nums ${r.warn && !r.lead.includes(":") ? "text-[var(--pm-danger-text)]" : "text-ink-950"}`}>{r.lead}</span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink-950">{r.title}</span>
        {r.meta ? <span className="block truncate text-sm text-text-muted">{r.meta}</span> : null}
      </span>
    </>
  );
  // Eylemi yalnız "Aç" olan satır TEK bağlantıdır (aynı hedefe iki öğe olmaz; ilk ekran etkileşim bütçesi).
  if (r.action.kind === "ac") {
    return (
      <li className="py-2" data-bugunum-satir="">
        <Link href={r.href} className="focus-ring flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-1">
          {body}
          <span className={buttonClass({ variant: "secondary", size: "lg", className: "pointer-events-none h-11 min-w-11 shrink-0" })} aria-hidden="true">
            Aç
          </span>
        </Link>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 py-2" data-bugunum-satir="">
      <Link href={r.href} className="focus-ring flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] px-1">
        {body}
      </Link>
      <Eylem r={r} />
    </li>
  );
}

function Eylem({ r }: { r: BugunumRow }) {
  const a = r.action;
  if (a.kind === "bitti") return <BittiDugmesi id={a.taskId} title={r.title} />;
  if (a.kind === "ac") return null; // `Satir` tek bağlantı olarak çizer.
  const cls = buttonClass({ variant: "primary", size: "lg", className: "h-11 min-w-11 shrink-0" });
  const external = a.kind === "yol";
  return (
    <a
      href={a.href}
      className={cls}
      aria-label={`${r.title}: ${a.label.toLocaleLowerCase("tr-TR")}`}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {a.kind === "yol" ? <Navigation className="h-4 w-4" aria-hidden="true" /> : <Phone className="h-4 w-4" aria-hidden="true" />}
      {a.label}
    </a>
  );
}
