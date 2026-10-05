import Link from "next/link";
import { FileText, Landmark, PlugZap } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { requireModulePage } from "@/lib/require-module-page";
import { formatDateTimeTr } from "@/lib/format";
import { getEfFeatureState, listTenantReports } from "@/lib/ef-credits/service";
import { guvenEtiketi } from "@/lib/ef-credits/present";
import { getEfIller } from "@/lib/integrations/emlakfiyati/ortak-client";
import { DegerlemeTabs } from "../degerleme-tabs";
import { ParselClient } from "./parsel-client";

// Değerleme çağrısı EmlakFiyati'nda 90 sn'ye kadar sürebilir (sözleşme: istemci zaman aşımı >= 90 sn); server action bu süreyi devralır.
export const maxDuration = 300;

export default async function ParselValuationPage() {
  const { tenantId } = await requireModulePage("valuation", "/app/degerleme");

  const header = (
    <PageHeader
      title="Ada/Parsel değerleme"
      eyebrow="EmlakFiyati ortak API"
      description="Ada/parsel için piyasa göstergesi: il > ilçe > mahalle seçin, ada ve parseli girin. Sonuç ilan fiyatlarına dayanır; insan onayı şarttır."
      icon={<Landmark className="h-6 w-6 text-brand-600" aria-hidden="true" />}
    />
  );

  if (!tenantId) {
    return (
      <div className="space-y-6">
        {header}
        <DegerlemeTabs active="parsel" />
        <EmptyState illustration="rapor" icon={PlugZap} title="Ofis bağlamı yok" description="Ada/parsel değerleme ofis kullanıcıları içindir. Bir ofisi görüntülerken kullanın." action={{ href: "/app/degerleme", label: "Değerleme motoruna dön" }} />
      </div>
    );
  }

  const state = await getEfFeatureState(tenantId);

  if (!state.ready) {
    return (
      <div className="space-y-6">
        {header}
        <DegerlemeTabs active="parsel" parselReady={false} />
        <section role="status" className="rounded-[var(--radius-panel)] border border-line bg-surface p-6 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
            <PlugZap className="h-5 w-5 text-amber-500" aria-hidden="true" /> Etkin değil
          </h2>
          <p className="mt-1 text-sm text-text-muted">Ada/parsel değerleme şu an kullanılamıyor.</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-950">
            {state.missing.length > 0 ? state.missing.map((m) => <li key={m}>{m}</li>) : <li>Kontör bakiyesi okunamadı; lütfen daha sonra tekrar deneyin.</li>}
          </ul>
          <Link href="/app/degerleme" className="focus-ring mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline">
            Değerleme motoruna dön →
          </Link>
        </section>
      </div>
    );
  }

  const [illerRes, reports] = await Promise.all([getEfIller(), listTenantReports(tenantId, 30)]);
  const iller = illerRes.ok ? illerRes.data.map((i) => ({ id: i.id, ad: i.ad })) : [];
  const illerError = illerRes.ok ? null : "İl listesi şu an alınamadı. Lütfen sayfayı birkaç dakika sonra yenileyin.";

  return (
    <div className="space-y-6">
      {header}
      <DegerlemeTabs active="parsel" />
      <ParselClient
        iller={iller}
        illerError={illerError}
        balance={state.balance?.available ?? 0}
        unitsArsa={state.tariff.valuationArsa}
        unitsKonut={state.tariff.valuationKonut}
        unitsPdf={state.tariff.pdfFirst}
      />

      <section id="gecmis-raporlar" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <FileText className="h-4 w-4 text-brand-600" aria-hidden="true" /> Geçmiş raporlar
        </h2>
        {reports === null || reports.length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
            Henüz ada/parsel raporu yok. Yukarıdan ilk değerlemenizi yapın; rapor burada listelenir.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {reports.map((r) => (
              <li key={r.rapor_id}>
                <Link
                  href={`/app/degerleme/parsel/rapor/${r.rapor_id}`}
                  className="focus-ring group flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-3 transition hover:bg-brand-600/[0.03]"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink-950 group-hover:text-brand-600">
                      Ada {r.ada ?? "—"} / Parsel {r.parsel ?? "—"} · {r.tip === "konut" ? "Konut" : "Arsa"}
                    </span>
                    <span className="block text-xs text-text-muted">{formatDateTimeTr(r.created_at)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-ink-950/6 px-2.5 py-0.5 text-text-muted">{guvenEtiketi(r.guven_sinifi)}</span>
                    <span className="rounded-full bg-ink-950/6 px-2.5 py-0.5 text-text-muted">{r.units_charged} kontör</span>
                    {r.pdf_charged ? <span className="rounded-full bg-mint-500/10 px-2.5 py-0.5 text-mint-700">PDF alındı</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
