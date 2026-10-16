import { KeyRound } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz/kapalı başvuru bağlantısı: gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz" };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={KeyRound}
      title="Başvuru bağlantısı geçersiz"
      description="Bu kiracı başvuru bağlantısı artık geçerli değil. İlanı paylaşan emlak ofisiyle iletişime geçin."
    />
  );
}
