import { Video } from "lucide-react";
import { VIRTUAL_TOUR_PROVIDER_LABEL, readVirtualTour } from "@/lib/virtual-tour";

/**
 * Vitrin ilan detayında 360° tur / video görüntüleyici. Kayıtlı bağlantı burada TEKRAR doğrulanır (izinli alan adı +
 * https); geçersiz/boş ise hiçbir şey çizilmez. iframe sandbox'lıdır: üst sayfaya gezinme, form ve açılır pencere YOK
 * (script + same-origin yalnız gömülü oynatıcının kendi çalışması içindir; oynatıcı farklı kökendir).
 */
export function VirtualTourEmbed({ features }: { features: unknown }) {
  const tour = readVirtualTour(features);
  if (!tour) return null;
  const label = VIRTUAL_TOUR_PROVIDER_LABEL[tour.provider];
  return (
    <section className="mt-5 rounded-[var(--radius-panel)] border border-line bg-surface p-5" aria-labelledby="sanal-tur">
      <h2 id="sanal-tur" className="flex items-center gap-2 font-display text-base font-extrabold text-ink-950">
        <Video className="h-4 w-4 text-brand-600" aria-hidden="true" /> 360° tur ve video
      </h2>
      <div className="mt-3 aspect-video w-full overflow-hidden rounded-[var(--radius-control)] border border-line bg-canvas">
        <iframe
          src={tour.embedUrl}
          title={`${label} - ilan`}
          className="h-full w-full"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope"
          allowFullScreen
        />
      </div>
      <p className="mt-2 text-xs text-text-faint">{label} · üçüncü taraf oynatıcı.</p>
    </section>
  );
}
