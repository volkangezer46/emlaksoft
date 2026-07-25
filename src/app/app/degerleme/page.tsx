import Link from "next/link";
import { FileText, Gauge, Landmark, MapPinned, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { isEndeksaConfiguredFull } from "@/lib/integrations/endeksa";
import { isTapusorConfiguredFull } from "@/lib/integrations/tapusor";
import { ValuationForm } from "./valuation-form";
import { DataPartnerStatus } from "@/components/app/data-partner-badges";

type ValuationSource = { name: string; weight: number; value: number; note: string };

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

export default async function ValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  await requireModulePage("valuation");
  const { property: preselectedPropertyId } = await searchParams;
  const supabase = await createClient();
  const [{ data: valuations }, { data: properties }, { data: provinces }, endeksaOn, tapusorOn] = await Promise.all([
    supabase
      .from("valuations")
      .select("id, title, estimated_low, estimated_mid, estimated_high, confidence, sources, created_at, property_id")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("geo_provinces").select("id, name").order("name"),
    isEndeksaConfiguredFull(),
    isTapusorConfiguredFull(),
  ]);

  const rows = valuations ?? [];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
              <Gauge className="h-3.5 w-3.5" /> Çok kaynaklı değerleme
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">Değerleme motoru</h1>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              Ofis listesi + emsal m² + <strong className="text-white">Endeksa</strong> bölge endeksi +{" "}
              <strong className="text-white">Tapusor</strong> EDİ yapay zeka değerlemesi — insan onayı şart.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <DataPartnerStatus name="Endeksa" icon={Landmark} configured={endeksaOn} />
            <DataPartnerStatus name="Tapusor" icon={MapPinned} configured={tapusorOn} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <ValuationForm properties={properties ?? []} provinces={provinces ?? []} defaultPropertyId={preselectedPropertyId} />
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Sparkles className="h-4 w-4 text-amber-500" /> Son değerlemeler
          </h2>
          {rows.length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
              Henüz değerleme yok. Soldan oluşturun.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {rows.map((v) => {
                const sources = (Array.isArray(v.sources) ? v.sources : []) as ValuationSource[];
                const priceSources = sources.filter((s) => s.weight > 0);
                const investmentScoreSource = sources.find((s) => s.name === "Tapusor yatırım puanı");
                return (
                  <article key={v.id} className="rounded-[14px] border border-line bg-canvas/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display font-bold text-ink-950">{v.title}</p>
                      <span className="text-[10px] font-bold text-mint-600">
                        %{Math.round(Number(v.confidence || 0) * 100)} güven
                      </span>
                    </div>
                    <p className="mt-2 font-display text-xl font-extrabold text-brand-600">
                      {money(v.estimated_mid != null ? Number(v.estimated_mid) : null)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {money(v.estimated_low != null ? Number(v.estimated_low) : null)} –{" "}
                      {money(v.estimated_high != null ? Number(v.estimated_high) : null)}
                    </p>
                    {priceSources.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {priceSources.map((s) => (
                          <span
                            key={s.name}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              s.name.includes("Endeksa")
                                ? "bg-cyan-500/10 text-cyan-700"
                                : s.name.includes("Tapusor")
                                  ? "bg-violet-500/10 text-violet-700"
                                  : "bg-ink-950/6 text-text-muted"
                            }`}
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {investmentScoreSource ? (
                      <p className="mt-2 text-[11px] font-semibold text-violet-600">
                        Tapusor yatırım puanı: {investmentScoreSource.value}/100
                      </p>
                    ) : null}
                    {/* Rapor bagi eklendi: degerleme uretiliyordu ama musteriye
                        verilecek bir CIKTISI yoktu — sonuc yalnizca bu karttaki
                        birkac satirdi. */}
                    <div className="hairline-t mt-3 flex flex-wrap items-center gap-3 pt-2.5">
                      <Link
                        href={`/app/degerleme/${v.id}`}
                        className="focus-ring inline-flex items-center gap-1 rounded-[8px] text-xs font-bold text-brand-600 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> Raporu aç
                      </Link>
                      {v.property_id ? (
                        <Link
                          href={`/app/portfoyler/${v.property_id}`}
                          className="focus-ring text-xs font-semibold text-text-muted hover:text-brand-600 hover:underline"
                        >
                          Portföye git →
                        </Link>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
