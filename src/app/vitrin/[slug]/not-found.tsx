import { Store } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

/**
 * Vitrin 404 (SK8 B153): ofis yok, pasif ya da vitrinini kapatmış. Gerçek HTTP 404; EmlakSoft pazarlama bağlantısı
 * ("Fiyatlar", "Ücretsiz deneyin") yok — bu sayfayı ofisin müşterisi görür. İlan detayının kendi 404'ü
 * `[id]/not-found.tsx` (ofis markalı "yayından kalktı" görünümü).
 */
export const metadata = { title: "Vitrin bulunamadı" };

export default function VitrinNotFound() {
  return (
    <PublicLinkNotFound
      icon={Store}
      title="Bu vitrin şu anda yayında değil"
      description="Ofis vitrini kapatılmış ya da bağlantı hatalı olabilir. Bağlantıyı size ileten ofisle iletişime geçin."
    />
  );
}
