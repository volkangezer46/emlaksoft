import Link from "next/link";
import { ArrowUpRight, CalendarDays, Phone } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AppointmentConfirmButton } from "../dashboard-quick-actions";
import { Widget } from "../dashboard-widgets";
import { loadTodayAppointments, type HomeCtx } from "./data";
import { apptTypeLabel, timeFmt } from "./format";
import { PanelLink } from "./ortak";

export async function Randevular({ ctx }: { ctx: HomeCtx }) {
  const { rows } = await loadTodayAppointments(ctx);
  // customer join'i obje/dizi gelebilir
  const todayAppointments = rows.map((a) => {
    const cust = Array.isArray(a.customer) ? a.customer[0] : a.customer;
    return {
      id: a.id,
      time: timeFmt.format(new Date(a.scheduled_at)),
      type: apptTypeLabel[a.appointment_type] ?? a.appointment_type,
      status: a.status as string,
      customerName: cust?.full_name ?? null,
      customerPhone: (cust?.phone as string | null | undefined) ?? null,
    };
  });

  return (
    <Widget id="randevular" className="h-full">
      <section className="pm-bx h-full p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-amber-500" />
            <h2 className="font-display font-bold text-ink-950">Bugünkü randevular</h2>
          </div>
          <PanelLink href="/app/randevular">
            Tümü <ArrowUpRight className="h-3.5 w-3.5" />
          </PanelLink>
        </div>
        {todayAppointments.length === 0 ? (
          <EmptyState
            variant="compact"
            illustration="randevu"
            tone="amber"
            title="Bugün planlı randevu yok"
            description="Müşteri görüşmesi ya da gösterim planlayın."
            action={{ href: "/app/hizli?sekme=randevu", label: "Randevu planla" }}
          />
        ) : (
          <ul className="mt-4 space-y-2.5">
            {todayAppointments.map((appt) => (
              <li key={appt.id} className="group relative">
                <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 transition group-hover:border-brand-300 group-hover:bg-surface">
                  <Link
                    href="/app/randevular"
                    className="focus-ring absolute inset-0 z-0 rounded-[var(--radius-card)]"
                    aria-label={`${appt.time} — ${appt.type}`}
                  />
                  <span className="shrink-0 rounded-[var(--radius-control)] bg-amber-400/15 px-2 py-1 text-xs font-bold tabular-nums text-amber-600">
                    {appt.time}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-950">{appt.type}</span>
                    {appt.customerName ? (
                      <span className="block truncate text-xs text-text-muted">{appt.customerName}</span>
                    ) : null}
                  </span>
                  {!ctx.tvMode && (
                    <span className="hover-action absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                      {appt.customerPhone ? (
                        <a
                          href={`tel:${appt.customerPhone}`}
                          title="Müşteriyi ara"
                          aria-label="Müşteriyi ara"
                          className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-mint-600 transition hover:border-mint-500/50 hover:bg-mint-500/10"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                      {appt.status === "pending" ? <AppointmentConfirmButton id={appt.id} /> : null}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Widget>
  );
}
