import { CalendarX2 } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz/süresi dolmuş token (SK8 B153): gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz" };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={CalendarX2}
      title="Randevu bağlantısı geçersiz"
      description="Bu randevu teyit bağlantısı artık geçerli değil. Randevunuz için ofisle iletişime geçin."
    />
  );
}
