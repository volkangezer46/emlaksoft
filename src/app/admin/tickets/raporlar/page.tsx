import Link from "@/components/ui/smart-link";
import { BarChart3, Clock3, ShieldCheck, Star, Ticket, Timer } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { StatRow } from "@/components/ui/stat-row";
import { daysAgoIso, now } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, type PlatformRole } from "@/lib/platform-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDeskReport, formatDurationHours, type BreakdownRow, type DeskCsatRow, type DeskTicketRow } from "@/lib/support/desk-report";
import { isMissingRelationError } from "@/lib/support/desk-data";
import { TicketsTabs } from "../kvkk/tickets-tabs";

export const metadata = { title: "Destek raporları" };

const RANGES = [7, 30, 90] as const;
/** Pencere üst sınırı: rapor hesabı bellekte; bu kadar bilet hızlı kalır (ölçüm notu: tipik hacim < 1.000/ay). */
const ROW_CAP = 5000;
const TICKET_COLUMNS =
  "id, created_at, status, category, priority, assigned_staff_id, first_response_at, first_response_due_at, first_response_breached_at, resolved_at, resolution_due_at, resolution_breached_at";

const CATEGORY_FALLBACK: Record<string, string> = {
  general: "Genel",
  billing: "Abonelik / fatura",
  bug: "Hata bildirimi",
  feature: "Özellik isteği",
  compliance: "İYS / KVKK",
  onboarding: "Kurulum",
};

function pct(value: number | null): string {
  return value == null ? "—" : `%${value.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
}

function weekLabel(key: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
}

function Breakdown({
  title,
  rows,
  labelOf,
  hrefOf,
  empty,
}: {
  title: string;
  rows: BreakdownRow[];
  labelOf: (key: string) => string;
  hrefOf: (key: string) => string;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <h2 className="font-display text-sm font-bold text-ink-950">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-text-faint">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.slice(0, 12).map((r) => (
            <li key={r.key}>
              <Link
                href={hrefOf(r.key)}
                className="focus-ring group block rounded-[var(--radius-control)] px-2 py-1.5 transition hover:bg-canvas"
              >
                <span className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-semibold text-ink-950 group-hover:text-brand-600">{labelOf(r.key)}</span>
                  <span className="shrink-0 tabular-nums text-text-muted">
                    {r.count.toLocaleString("tr-TR")} talep{r.open ? ` · ${r.open} açık` : ""}
                  </span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
                  <span className="block h-full rounded-full bg-brand-500/70" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Destek BI sekmesi (AD9): dönem içinde açılan biletlerde ilk yanıt/çözüm medyanı ve p90'ı, SLA uyum oranı ve
 * haftalık trendi, temsilci hacmi, CSAT trendi, kategori ve etiket kırılımı. Her satır filtrelenmiş kuyruğa gider.
 * Dosya çıktısı yok (rapor merkezi kuralı).
 */
export default async function SupportReportsPage({ searchParams }: { searchParams?: Promise<{ gun?: string }> }) {
  await requirePlatformModule("tickets");
  const params = (await searchParams) ?? {};
  const days = RANGES.find((r) => String(r) === params.gun) ?? 30;
  const since = daysAgoIso(days);
  const admin = createAdminClient();

  const withTags = admin
    .from("support_tickets")
    .select(`${TICKET_COLUMNS}, tags`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  const [ticketsResult, csatResult, staffResult, categoryResult] = await Promise.all([
    withTags,
    admin.from("support_ticket_csat").select("score, created_at").gte("created_at", since).limit(ROW_CAP),
    admin.from("platform_staff").select("id, full_name, role"),
    admin.from("definitions").select("value, label").eq("category", "ticket_category").is("tenant_id", null),
  ]);

  let tagsInstalled = true;
  let ticketRows = ticketsResult.data as DeskTicketRow[] | null;
  if (ticketsResult.error) {
    if (!isMissingRelationError(ticketsResult.error)) throw new Error(`Destek raporu yüklenemedi: ${ticketsResult.error.message}`);
    // Migration öncesi: etiket kolonu yok; rapor etiketsiz hesaplanır.
    tagsInstalled = false;
    const fallback = await admin
      .from("support_tickets")
      .select(TICKET_COLUMNS)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP);
    if (fallback.error) throw new Error(`Destek raporu yüklenemedi: ${fallback.error.message}`);
    ticketRows = fallback.data as DeskTicketRow[];
  }
  if (csatResult.error) throw new Error(`CSAT yüklenemedi: ${csatResult.error.message}`);

  const rows = ticketRows ?? [];
  const report = computeDeskReport(rows, (csatResult.data ?? []) as DeskCsatRow[], now());
  const capped = rows.length >= ROW_CAP;
  const staff = new Map((staffResult.data ?? []).map((s) => [s.id as string, s as { id: string; full_name: string; role: string }]));
  const categoryLabels = new Map<string, string>(Object.entries(CATEGORY_FALLBACK));
  for (const c of categoryResult.data ?? []) categoryLabels.set(c.value, c.label);

  const agentLabel = (key: string) => {
    if (key === "atanmadi") return "Atanmamış";
    const s = staff.get(key);
    return s ? `${s.full_name} · ${PLATFORM_ROLE_LABELS[s.role as PlatformRole] ?? s.role}` : "Eski personel";
  };
  const maxWeekTickets = Math.max(1, ...report.weeks.map((w) => w.tickets));

  return (
    <div className="space-y-4">
      <TicketsTabs active="raporlar" />
      <AdminPageHeader
        eyebrow="Destek"
        icon={BarChart3}
        title="Destek raporları"
        description={`Son ${days} günde açılan talepler: yanıt ve çözüm süreleri, SLA uyumu (iş saatine göre hedef), temsilci yükü, müşteri memnuniyeti. Dosya çıktısı: Raporlar merkezi.`}
      />

      <nav aria-label="Dönem" className="flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <FilterChip key={r} href={r === 30 ? "/admin/tickets/raporlar" : `/admin/tickets/raporlar?gun=${r}`} active={r === days}>
            Son {r} gün
          </FilterChip>
        ))}
      </nav>

      {capped ? (
        <Alert tone="warning" title="Dönem çok kalabalık">
          Rapor en yeni {ROW_CAP.toLocaleString("tr-TR")} talep üzerinden hesaplandı; daha kısa bir dönem seçin.
        </Alert>
      ) : null}

      {report.total === 0 ? (
        <EmptyState
          icon={Ticket}
          title={`Son ${days} günde açılan talep yok`}
          description="Talep geldikçe yanıt süresi, SLA uyumu ve memnuniyet burada hesaplanır."
        />
      ) : (
        <>
          <StatRow
            label="Destek göstergeleri"
            items={[
              {
                label: `SLA uyum oranı (${days} gün)`,
                value: pct(report.overallSla.rate),
                hint: `${report.overallSla.met}/${report.overallSla.measured} hedef tutturuldu`,
                href: "/admin/tickets?sla=breached",
                icon: <ShieldCheck className="h-4 w-4" />,
                attention: report.overallSla.rate != null && report.overallSla.rate < 80,
              },
              {
                label: "CSAT ortalaması",
                value: report.csat.average == null ? "—" : `${report.csat.average.toLocaleString("tr-TR")}/5`,
                hint: `${report.csat.count} değerlendirme`,
                href: "/admin/tickets?durum=cozulmus",
                icon: <Star className="h-4 w-4" />,
              },
              {
                label: "İlk yanıt (medyan · p90)",
                value: formatDurationHours(report.firstResponse.medianHours),
                hint: `p90 ${formatDurationHours(report.firstResponse.p90Hours)} · ${report.firstResponse.count} talep`,
                href: "/admin/tickets?durum=open",
                icon: <Timer className="h-4 w-4" />,
              },
              {
                label: "Çözüm (medyan · p90)",
                value: formatDurationHours(report.resolution.medianHours),
                hint: `p90 ${formatDurationHours(report.resolution.p90Hours)} · ${report.resolution.count} talep`,
                href: "/admin/tickets?durum=cozulmus",
                icon: <Clock3 className="h-4 w-4" />,
              },
              {
                label: "Açık talep",
                value: report.open,
                hint: `${report.total} talep açıldı`,
                href: "/admin/tickets?durum=acik",
                icon: <Ticket className="h-4 w-4" />,
                attention: report.open > 0,
              },
            ]}
          />

          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold text-ink-950">Haftalık trend</h2>
                <p className="text-xs text-text-muted">
                  İlk yanıt {pct(report.firstResponseSla.rate)} · çözüm {pct(report.resolutionSla.rate)} hedefinde. Hedefler plan ve önceliğe göre iş saatiyle hesaplanır.
                </p>
              </div>
              <Link href="/admin/tickets/ayarlar?sekme=sla" className="text-xs font-semibold text-brand-600 hover:underline">
                SLA hedefleri →
              </Link>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="text-left text-text-faint">
                    <th className="py-1.5 font-semibold">Hafta</th>
                    <th className="py-1.5 font-semibold">Talep</th>
                    <th className="py-1.5 font-semibold">SLA uyumu</th>
                    <th className="py-1.5 font-semibold">CSAT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.weeks.map((w) => (
                    <tr key={w.weekStart}>
                      <td className="py-1.5 font-semibold text-ink-950">{weekLabel(w.weekStart)} haftası</td>
                      <td className="py-1.5">
                        <Link href="/admin/tickets?sirala=created_at" className="flex items-center gap-2 hover:text-brand-600">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-canvas" aria-hidden>
                            <span className="block h-full rounded-full bg-brand-500/70" style={{ width: `${(w.tickets / maxWeekTickets) * 100}%` }} />
                          </span>
                          <span className="tabular-nums">{w.tickets}</span>
                        </Link>
                      </td>
                      <td className="py-1.5 tabular-nums">
                        <Link href="/admin/tickets?sla=breached" className={w.compliance != null && w.compliance < 80 ? "font-semibold text-danger-600 hover:underline" : "hover:text-brand-600"}>
                          {pct(w.compliance)}
                        </Link>
                      </td>
                      <td className="py-1.5 tabular-nums">
                        <Link href="/admin/tickets?durum=cozulmus" className="hover:text-brand-600">
                          {w.csatAverage == null ? "—" : `${w.csatAverage.toLocaleString("tr-TR")}/5 (${w.csatCount})`}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <Breakdown
              title="Temsilci bazlı hacim"
              rows={report.byAgent}
              labelOf={agentLabel}
              hrefOf={(key) => `/admin/tickets?atanan=${encodeURIComponent(key)}&sirala=created_at`}
              empty="Atama yok."
            />
            <Breakdown
              title="Kategori kırılımı"
              rows={report.byCategory}
              labelOf={(key) => categoryLabels.get(key) ?? key}
              hrefOf={(key) => `/admin/tickets?kategori=${encodeURIComponent(key)}&sirala=created_at`}
              empty="Kategori yok."
            />
            <Breakdown
              title="Etiket kırılımı"
              rows={report.byTag}
              labelOf={(key) => `#${key}`}
              hrefOf={(key) => `/admin/tickets?etiket=${encodeURIComponent(key)}`}
              empty={tagsInstalled ? "Bu dönemde etiketli talep yok. Etiketler talep detayından veya makrolarla eklenir." : "Etiketler kurulum bekliyor (migration 20261013004800)."}
            />
          </div>
        </>
      )}
    </div>
  );
}
