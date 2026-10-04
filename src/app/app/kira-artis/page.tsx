import { ShieldCheck, Scale } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { TUFE_12M_AVG, TUFE_PENDING_MONTHS, latestTufeMonth } from "@/lib/tufe";
import { RentCalculator } from "./rent-calculator";

import { PageHeader } from "@/components/ui/page-header";
export const metadata = { title: "Kira Artış Hesaplama" };

export default async function KiraArtisPage() {
  await requireModulePage("valuation", "/app/kira-artis");
  // Resmi verili aylar + resmi oranı henüz açıklanmamış (2026) aylar birlikte;
  // en yeni ay üstte. 2026 ayları seçilince hesaplayıcı manuel giriş ister.
  const months = [...Object.keys(TUFE_12M_AVG), ...TUFE_PENDING_MONTHS].sort().reverse();
  const latest = latestTufeMonth();

  return (
    <div className="space-y-6">
      <PageHeader title="Kira artış hesaplama" eyebrow="TÜFE kira artışı" description="12 aylık ortalama TÜFE’ye göre yasal tavanı otomatik uygular; yeni kirayı, aylık ve yıllık farkı anında gösterir." actions={
<div className="theme-dark flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2"><div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-white/12 bg-white/8 px-4 py-3">
            <Scale className="h-5 w-5 text-cyan-400" />
            <div>
              <p className="text-xs text-white/60">TBK m.344</p>
              <p className="text-sm font-semibold text-white">Yasal tavan uyumlu</p>
            </div>
          </div></div>
} />

      <RentCalculator months={months} latestMonth={latest} />

      <section className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-text-muted shadow-[var(--shadow-xs)]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" />
        <p>
          Konut kiralarında artış, önceki kira yılındaki 12 aylık ortalama TÜFE oranını aşamaz. Bu araç TÜİK referans
          verisiyle hesaplar; nihai oran için TÜİK’in ilgili ay verisini esas alın. İş yeri kiralarında sözleşme
          serbestisi geçerli olabilir.
        </p>
      </section>
    </div>
  );
}
