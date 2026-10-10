import Link from "@/components/ui/smart-link";
import { Landmark, PlugZap } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { getEfFeatureState, listTenantReports } from "@/lib/ef-credits/service";
import { EF_REPORT_FETCH_LIMIT, canViewAllEfReports } from "@/lib/ef-credits/visibility";
import { getEfIller } from "@/lib/integrations/emlakfiyati/ortak-client";
import { DegerlemeTabs } from "../degerleme-tabs";
import { ParselClient } from "./parsel-client";
import { ReportArchive, type ArchiveParams } from "./report-archive";

// Değerleme çağrısı EmlakFiyati'nda 90 sn'ye kadar sürebilir (sözleşme: istemci zaman aşımı >= 90 sn); server action bu süreyi devralır.
export const maxDuration = 300;

export default async function ParselValuationPage({ searchParams }: { searchParams?: Promise<ArchiveParams> }) {
  const archiveParams = (await searchParams) ?? {};
  const { tenantId, userId, role } = await requireModulePage("valuation", "/app/degerleme");

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

  // Görünürlük: kendi raporu + owner/gm (service.ts süzgeci; başka danışmanın raporu hiç çekilmez).
  const canSeeAll = canViewAllEfReports(role);
  const [illerRes, reports] = await Promise.all([getEfIller(), listTenantReports(tenantId, EF_REPORT_FETCH_LIMIT, { userId, role })]);
  const userNames: Record<string, string> = {};
  if (canSeeAll && reports && reports.length > 0) {
    const ids = [...new Set(reports.map((r) => r.user_id).filter((v): v is string => !!v))];
    if (ids.length > 0) {
      const supabase = await createClient();
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      for (const p of profs ?? []) userNames[p.id as string] = (p.full_name as string | null) || "Kullanıcı";
    }
  }
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
      />

      <ReportArchive reports={reports} params={archiveParams} canSeeAll={canSeeAll} userNames={userNames} />
    </div>
  );
}
