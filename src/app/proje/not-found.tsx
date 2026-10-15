import { Building2 } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz ya da kapatılmış proje bağlantısı: gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={Building2}
      title="Proje bağlantısı geçersiz"
      description="Bu proje sayfası kapatılmış ya da bağlantı yenilenmiş. Bağlantıyı gönderen ofisle iletişime geçin."
    />
  );
}
