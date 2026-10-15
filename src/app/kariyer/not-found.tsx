import { BriefcaseBusiness } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz/yenilenmiş kariyer formu bağlantısı: gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz" };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={BriefcaseBusiness}
      title="Başvuru bağlantısı geçersiz"
      description="Bu danışman başvuru bağlantısı artık geçerli değil. Başvurmak istediğiniz ofisle iletişime geçin; size güncel bağlantıyı iletebilirler."
    />
  );
}
