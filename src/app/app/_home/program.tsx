import Link from "@/components/ui/smart-link";
import { AlertTriangle, ChevronRight, Navigation, Route } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { loadTodayAppointments, type HomeCtx } from "./data";
import { formatTrTime } from "@/lib/clock";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { appointmentHref } from "@/lib/notification-text";
import { buildRoutePlan, directionsHref, routeDirectionsHref } from "@/lib/route-plan";
import { scheduleWarnings, scheduleWarningText } from "./home-brief";

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));

/**
 * BUGÜNKÜ RANDEVULAR (program): YALNIZ randevular, saat sırasıyla numaralı duraklar (sadeleştirme planı C09). Saatsiz ya da
 * otomatik görevler buraya GİRMEZ (eskiden "00:00 İlan sahibi bilgilerini tamamlat" satırları randevuların önüne düşüyordu);
 * görevler kendi listesindedir (danışmanda "Bugünüm > Gecikmiş görevler", Görevler sayfası). Her satır 2 satırlık karttır:
 * saat + tür, altında müşteri; durak başına yol tarifi (koordinat > konum metni), koordinatlı ≥2 durakta günün TÜM rotası
 * tek bağlantıda. Sıkışık geçiş uyarısı: koordinat varsa kuş uçuşu tahmini yol süresi (`buildRoutePlan`, 40 km/s), yoksa
 * 45 dk saat kuralı.
 */
export async function Program({ ctx }: { ctx: HomeCtx }) {
  const { rows, total } = await loadTodayAppointments(ctx);
  const items = rows.map((a) => {
    const cust = one(a.customer as Rel<{ full_name?: string | null }>);
    const prop = one(a.property as Rel<{ lat?: number | null; lng?: number | null }>);
    const lat = prop?.lat ?? null;
    const lng = prop?.lng ?? null;
    const location = (a.location as string | null | undefined) ?? null;
    return {
      id: a.id as string,
      scheduledAt: a.scheduled_at as string,
      at: new Date(a.scheduled_at as string).getTime(),
      durationMin: (a.duration_min as number | null | undefined) ?? null,
      time: formatTrTime(a.scheduled_at as string),
      type: appointmentTypeLabel(a.appointment_type),
      customer: (cust?.full_name as string | undefined) ?? null,
      pending: a.status === "pending",
      lat,
      lng,
      location,
      directions: directionsHref({ lat, lng, location }),
    };
  });
  const plan = buildRoutePlan(items.map((i) => ({ id: i.id, scheduledAt: i.scheduledAt, durationMin: i.durationMin, lat: i.lat, lng: i.lng })));
  const coordStops = items.filter((i) => i.lat != null && i.lng != null).length;
  const timeWarnings = scheduleWarnings(items.map((i) => i.at));
  const warningText =
    coordStops >= 2
      ? plan.tightCount > 0
        ? `${plan.tightCount} geçişte süre yetmeyebilir (kuş uçuşu tahmini yol süresi randevu aralığından uzun).`
        : null
      : timeWarnings.length > 0
        ? `${scheduleWarningText(timeWarnings[0]!)}${timeWarnings.length > 1 ? ` (+${timeWarnings.length - 1} uyarı daha)` : ""}`
        : null;
  const fullRoute = routeDirectionsHref(items);
  // Duraklar: rota sırası = saat sırası (yalnız randevu).
  const timeline = plan.stops.flatMap((st, idx) => {
    const a = items.find((i) => i.id === st.id);
    return a ? [{ n: idx + 1, a }] : [];
  });

  return (
    <section aria-labelledby="program-baslik" className="pm-c1 flex h-full min-h-[15rem] flex-col p-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="program-baslik" className="pm-bx-eyebrow">
          Bugünkü randevular
        </h2>
        <span className="flex items-center gap-1">
          {items.length > 0 ? (
            <Link
              href="/app/randevular?gorunum=rota&gun=bugun"
              className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm font-semibold text-[var(--accent-text)]"
            >
              <Route className="h-3.5 w-3.5" aria-hidden="true" /> Rota
            </Link>
          ) : null}
          <Link href="/app/randevular" className="focus-ring inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-2 text-sm font-semibold text-[var(--accent-text)]">
            {total > items.length ? `Tümü (${total})` : "Randevular"}
          </Link>
        </span>
      </div>
      {warningText ? (
        <p role="note" className="pm-t-warn mt-2 flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--t-soft)] px-3 py-2 text-xs font-semibold text-[var(--t-text)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>{warningText}</span>
        </p>
      ) : null}
      {timeline.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="randevu"
          tone="amber"
          title="Bugün planlı randevu yok"
          description="Müşteri görüşmesi ya da gösterim planlayın."
          action={{ href: "/app/hizli?sekme=randevu", label: "Randevu planla" }}
        />
      ) : (
        <>
          <ol className="pm-sep mt-2">
            {timeline.map(({ a, n: idx1 }) => (
              <li key={a.id} className="flex items-center gap-1" data-program-satir="">
                <Link href={appointmentHref(a.id)} className="focus-ring group flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] px-1 py-2 hover:bg-surface-hover">
                  <span aria-hidden="true" className="grid h-6 w-6 flex-none place-items-center rounded-full bg-[var(--accent-soft,var(--surface-hover))] text-xs font-bold text-[var(--accent-text)]">
                    {idx1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-bold tabular-nums text-ink-950">{a.time}</span>
                      <span className="truncate text-[15px] font-medium text-[var(--text)]">{a.type}</span>
                      {a.pending ? <span className="pm-t-warn flex-none rounded-full bg-[var(--t-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--t-text)]">Teyit bekliyor</span> : null}
                    </span>
                    <span className="block truncate text-sm text-text-muted">{a.customer ?? "Müşteri seçilmedi"}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-none text-[var(--text-faint)] group-hover:text-[var(--accent-text)]" aria-hidden="true" />
                </Link>
                {a.directions ? (
                  <a
                    href={a.directions}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${a.time} ${a.type} için yol tarifi`}
                    className="focus-ring grid h-11 w-11 flex-none place-items-center rounded-[var(--radius-control)] text-[var(--accent-text)] hover:bg-surface-hover"
                  >
                    <Navigation className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
          {fullRoute ? (
            <a
              href={fullRoute}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring mt-2 inline-flex min-h-10 items-center gap-1.5 self-start rounded-full border border-hairline px-3 text-xs font-semibold text-[var(--accent-text)] hover:bg-surface-hover touch:min-h-11"
            >
              <Navigation className="h-3.5 w-3.5" aria-hidden="true" /> Günün rotasını haritada aç ({coordStops} durak)
            </a>
          ) : null}
        </>
      )}
    </section>
  );
}
