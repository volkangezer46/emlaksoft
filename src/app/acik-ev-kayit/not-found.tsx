import { DoorOpen } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz/süresi dolmuş token (SK8 B153): gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz" };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={DoorOpen}
      title="Açık ev bağlantısı geçersiz"
      description="Bu açık ev kayıt bağlantısı artık geçerli değil. Etkinliği düzenleyen ofisle iletişime geçin."
    />
  );
}
