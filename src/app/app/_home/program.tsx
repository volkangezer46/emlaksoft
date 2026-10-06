import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { loadTodayAppointments, type HomeCtx } from "./data";
import { apptTypeLabel, timeFmt } from "./format";
import { scheduleWarnings, scheduleWarningText } from "./home-brief";

/**
 * BUGÜNÜN PROGRAMI: sıralı randevu satırları (saat, tür, müşteri) + rota uyarısı.
 * Rota uyarısı yalnız GERÇEK randevu saatlerinden türer: ardışık iki randevu arası 45 dakikadan kısaysa uyarır
 * (konum verisi yok; yol süresi tahmini yapılmaz). Ana ekranda tek randevu satırı kaynağı budur.
 */
export async function Program({ ctx }: { ctx: HomeCtx }) {
  const { rows, total } = await loadTodayAppointments(ctx);
  const items = rows.map((a) => {
    const cust = Array.isArray(a.customer) ? a.customer[0] : a.customer;
    return {
      id: a.id as string,
      at: new Date(a.scheduled_at as string).getTime(),
      time: timeFmt.format(new Date(a.scheduled_at as string)),
      type: apptTypeLabel[a.appointment_type] ?? a.appointment_type,
      customer: (cust?.full_name as string | undefined) ?? null,
      pending: a.status === "pending",
    };
  });
  const warnings = scheduleWarnings(items.map((i) => i.at));

  return (
    <section aria-labelledby="program-baslik" className="pm-c1 flex h-full min-h-[15rem] flex-col p-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="program-baslik" className="pm-bx-eyebrow">
          Bugünün programı
        </h2>
        <Link href="/app/randevular" className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-[var(--accent-text)]">
          {total > items.length ? `Tümü (${total})` : "Randevular"}
        </Link>
      </div>
      {warnings.length > 0 ? (
        <p role="note" className="pm-t-warn mt-2 flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--t-soft)] px-3 py-2 text-xs font-semibold text-[var(--t-text)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          <span>{scheduleWarningText(warnings[0]!)}{warnings.length > 1 ? ` (+${warnings.length - 1} uyarı daha)` : ""}</span>
        </p>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="randevu"
          tone="amber"
          title="Bugün planlı randevu yok"
          description="Müşteri görüşmesi ya da gösterim planlayın."
          action={{ href: "/app/hizli?sekme=randevu", label: "Randevu planla" }}
        />
      ) : (
        <ol className="pm-sep mt-2">
          {items.map((a) => (
            <li key={a.id}>
              <Link href="/app/randevular" className="pm-r36 focus-ring group min-h-10">
                <span className="w-12 flex-none text-sm font-bold tabular-nums text-ink-950">{a.time}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--text)]">{a.type}</span>
                  {a.customer ? <span className="block truncate text-xs text-text-muted">{a.customer}</span> : null}
                </span>
                {a.pending ? <span className="pm-t-warn flex-none rounded-full bg-[var(--t-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--t-text)]">Teyit bekliyor</span> : null}
                <ChevronRight className="h-4 w-4 flex-none text-[var(--text-faint)] group-hover:text-[var(--accent-text)]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
