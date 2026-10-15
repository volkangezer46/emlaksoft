import { Building2 } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz/süresi dolmuş token (SK8 B153): gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz" };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={Building2}
      title="Malik paneli bağlantısı geçersiz"
      description="Bu malik paneli bağlantısı artık geçerli değil. Danışmanınızla iletişime geçin; size yeni bir bağlantı iletebilir."
    />
  );
}
