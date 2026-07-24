import { Percent, ShieldCheck, Scale } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { TUFE_12M_AVG, latestTufeMonth } from "@/lib/tufe";
import { RentCalculator } from "./rent-calculator";

export const metadata = { title: "Kira Artış Hesaplama" };

export default async function KiraArtisPage() {
  await requireModulePage("valuation");
  const months = Object.keys(TUFE_12M_AVG).sort().reverse();
  const latest = latestTufeMonth();

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-mint-500/25 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-300">
              <Percent className="h-4 w-4" /> TÜFE kira artışı
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Kira artış hesaplama</h1>
            <p className="mt-1 max-w-xl text-sm text-white/70">
              12 aylık ortalama TÜFE'ye göre yasal tavanı otomatik uygular; yeni kirayı, aylık ve yıllık farkı anında gösterir.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-[14px] border border-white/12 bg-white/8 px-4 py-3">
            <Scale className="h-5 w-5 text-cyan-400" />
            <div>
              <p className="text-[11px] text-white/60">TBK m.344</p>
              <p className="text-sm font-semibold text-white">Yasal tavan uyumlu</p>
            </div>
          </div>
        </div>
      </section>

      <RentCalculator months={months} latestMonth={latest} />

      <section className="flex items-start gap-3 rounded-[16px] border border-line bg-surface p-4 text-sm text-text-muted shadow-[var(--shadow-xs)]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" />
        <p>
          Konut kiralarında artış, önceki kira yılındaki 12 aylık ortalama TÜFE oranını aşamaz. Bu araç TÜİK referans
          verisiyle hesaplar; nihai oran için TÜİK'in ilgili ay verisini esas alın. İş yeri kiralarında sözleşme
          serbestisi geçerli olabilir.
        </p>
      </section>
    </div>
  );
}
