import { ExternalLink, Landmark, ShieldAlert } from "lucide-react";
import { CopyTextButton } from "@/components/app/copy-text-button";
import { AFAD_TDTH_URL, DASK_URL, TKGM_PARSEL_SORGU_URL, parcelQueryText, type ParcelInput } from "@/lib/public-records";

const linkClass =
  "focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm font-semibold text-ink-950 transition hover:border-brand-400";

/**
 * Portföy detayı — kamu kayıt kısayolları: TKGM parsel sorgu (ada/parsel varsa) ve deprem/DASK bilgi kartı.
 * Yalnızca dış bağlantı; veri gönderilmez. Bağlantılar yeni sekmede, `noopener noreferrer` ile açılır.
 */
export function PropertyPublicRecordsCard({ parcel }: { parcel: ParcelInput }) {
  const query = parcelQueryText(parcel);
  return (
    <section
      data-property-public-records
      className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5"
    >
      <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
        <Landmark className="h-4 w-4" aria-hidden /> Kamu kayıtları
      </p>
      <h2 className="mt-1 font-display font-bold text-ink-950">Parsel ve deprem kontrolü</h2>

      {query ? (
        <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">TKGM parsel sorgu</p>
          <p className="mt-1 text-sm font-semibold text-ink-950">{query}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Sorgu ekranında il, ilçe, mahalle, ada ve parseli seçin; bilgiyi panoya kopyalayıp kullanabilirsiniz.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={TKGM_PARSEL_SORGU_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Parsel sorgula (TKGM)
            </a>
            <CopyTextButton text={query} label="Ada/parseli kopyala" doneMessage="Parsel bilgisi kopyalandı" />
          </div>
        </div>
      ) : null}

      <div className="mt-4 rounded-[var(--radius-card)] border border-amber-400/25 bg-amber-400/5 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Deprem ve DASK
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Alıcıya bölgenin deprem tehlike değerini ve binanın zorunlu deprem sigortası (DASK) durumunu resmi kaynaktan
          kontrol etmesini önerin. Bilgiler resmi sitelerde sorgulanır; burada saklanmaz.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={AFAD_TDTH_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> AFAD deprem tehlike haritası
          </a>
          <a href={DASK_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> DASK poliçe sorgulama
          </a>
        </div>
      </div>
    </section>
  );
}
