import { Download, ShieldCheck } from "lucide-react";

/**
 * Emlakfiyati anonim piyasa verisi indirme kartı (yalnız süper admin görür). Veri: `/admin/ef-kontor/piyasa-verisi`
 * (opt-in ofisler, k≥5, hücre başına en az 2 ofis; kişisel veri yok). Otomatik gönderim YOK: dosya elle paylaşılır.
 */
export function MarketExportCard() {
  const link =
    "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm font-semibold text-text transition hover:border-brand-300 hover:text-accent-text";
  return (
    <section id="piyasa-verisi" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 font-display font-bold text-text">
            <ShieldCheck className="h-4 w-4 text-accent-text" aria-hidden="true" /> Anonim piyasa verisi (EmlakFiyati)
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Yalnız &quot;Anonim piyasa verisi paylaşımı&quot; iznini açan ofislerin yayındaki ilanlarından ilçe × portföy türü × ay
            hücreleri. Her hücrede en az 5 ilan ve en az 2 farklı ofis bulunur; ofis, ilan, adres, malik veya danışman bilgisi yoktur.
            Dosya EmlakFiyati&apos;na otomatik gönderilmez.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/admin/ef-kontor/piyasa-verisi?bicim=csv" className={link} download>
            <Download className="h-4 w-4" aria-hidden="true" /> CSV indir
          </a>
          <a href="/admin/ef-kontor/piyasa-verisi?bicim=json" className={link} download>
            <Download className="h-4 w-4" aria-hidden="true" /> JSON indir
          </a>
        </div>
      </div>
    </section>
  );
}
