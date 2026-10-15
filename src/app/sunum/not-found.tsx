import { Presentation } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz/süresi dolmuş token (SK8 B153): gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz" };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={Presentation}
      title="Sunum bağlantısı geçersiz"
      description="Bu sunum bağlantısı artık geçerli değil. Sunumu hazırlayan danışmanınızla iletişime geçin."
    />
  );
}
