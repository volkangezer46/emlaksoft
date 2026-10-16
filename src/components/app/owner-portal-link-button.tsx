import Link from "@/components/ui/smart-link";
import { Share2 } from "lucide-react";

/**
 * Malik portalı linki: portföy kart / satır eylemi. Popup YOK; portföy detayındaki
 * "Portallar" sekmesinde sayfa içi panel açılır (oluştur, kopyala, süre uzat, iptal).
 * Sunucu bileşeni (yalnız bağlantı): liste sayfasının ilk yük JS'ine portal paneli kodunu çekmez.
 */
export function OwnerPortalLinkButton({
  propertyId,
  propertyLabel,
}: {
  propertyId: string;
  propertyLabel: string;
}) {
  return (
    <Link
      href={`/app/portfoyler/${propertyId}?sekme=portallar#malik-portali`}
      className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted shadow-[var(--shadow-xs)] transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11 touch:min-w-11"
      aria-label={`${propertyLabel} için malik portalı linki`}
      title="Malik portalı linki"
    >
      <Share2 className="h-4 w-4" />
    </Link>
  );
}
