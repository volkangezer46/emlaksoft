import Link from "@/components/ui/smart-link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireModulePage } from "@/lib/require-module-page";
import { formatDateTimeTr } from "@/lib/format";
import { now } from "@/lib/clock";
import { getEfFeatureState, getOwnedReport } from "@/lib/ef-credits/service";
import {
  EF_PDF_DEADLINE_WARNING,
  EF_REPORT_VALID_DAYS,
  pdfStatusOf,
  reportValidity,
  validityLabel,
} from "@/lib/ef-credits/visibility";
import { DegerlemeTabs } from "../../../degerleme-tabs";
import { ReportDetailClient } from "./report-detail-client";

export const maxDuration = 300;

export default async function ParselReportPage({ params }: { params: Promise<{ raporId: string }> }) {
  const { raporId } = await params;
  const { tenantId, userId, role } = await requireModulePage("valuation", "/app/degerleme");
  if (!tenantId) notFound();

  // rapor_id bir ERİŞİM ANAHTARIDIR: başka ofisin raporu ve (owner/gm değilsek) başka danışmanın raporu da 404 verir.
  const owned = await getOwnedReport(tenantId, raporId, { userId, role });
  if (!owned.ok && owned.status === "expired") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Rapor süresi doldu"
          eyebrow="Ada/Parsel raporu"
          description={`Raporlar ${EF_REPORT_VALID_DAYS} gün geçerlidir; bu raporun süresi dolduğu için artık açılamaz ve PDF indirilemez.`}
          breadcrumbs={[
            { label: "Değerleme", href: "/app/degerleme" },
            { label: "Ada/Parsel", href: "/app/degerleme/parsel" },
            { label: "Rapor" },
          ]}
        />
        <section role="status" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-sm text-text-muted shadow-[var(--shadow-xs)]">
          <p>Aynı parsel için yeni bir değerleme yapabilirsiniz; değerleme tarifesine göre kontör düşer.</p>
          <Link href="/app/degerleme/parsel#gecmis-raporlar" className="focus-ring mt-4 inline-block font-semibold text-brand-600 hover:underline">
            ← Rapor arşivine dön
          </Link>
        </section>
      </div>
    );
  }
  if (!owned.ok) notFound();
  const row = owned.row;
  const validity = reportValidity(row, now());
  const state = await getEfFeatureState(tenantId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Ada ${row.ada ?? "—"} / Parsel ${row.parsel ?? "—"}`}
        eyebrow="Ada/Parsel raporu"
        description={`${row.tip === "konut" ? "Konut" : "Arsa"} değerleme raporu · ${formatDateTimeTr(row.created_at)}`}
        breadcrumbs={[
          { label: "Değerleme", href: "/app/degerleme" },
          { label: "Ada/Parsel", href: "/app/degerleme/parsel" },
          { label: "Rapor" },
        ]}
      />
      <DegerlemeTabs active="parsel" parselReady={state.ready} />
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted">
            {row.expires_at ? `Rapor ${formatDateTimeTr(row.expires_at)} tarihine kadar geçerlidir` : "Rapor geçerlilik tarihi bildirilmedi"}
            {validity.daysLeft !== null ? ` (${validityLabel(validity).toLocaleLowerCase("tr-TR")}).` : "."} {pdfStatusOf(row, false).label}.
          </p>
          {state.ready ? (
            <a
              href={`/api/app/ef-rapor/${row.rapor_id}/pdf`}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-xs font-semibold text-white"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> PDF indir
              {" "}(kontör düşmez)
            </a>
          ) : null}
        </div>
        <p role="note" className="mt-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-700">
          {EF_PDF_DEADLINE_WARNING}
        </p>
        {state.ready ? (
          <ReportDetailClient raporId={row.rapor_id} />
        ) : (
          <div role="status" className="mt-4 space-y-1 text-sm text-text-muted">
            <p className="font-semibold text-ink-950">Ada/parsel değerleme şu an etkin değil; rapor detayı görüntülenemiyor.</p>
            <ul className="list-disc pl-5">
              {state.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        <Link href="/app/degerleme/parsel#gecmis-raporlar" className="focus-ring mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline">
          ← Geçmiş raporlara dön
        </Link>
      </section>
    </div>
  );
}
