import { Share2 } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";

// Geçersiz/süresi dolmuş token (SK8 B153): gerçek HTTP 404 (rotada loading.tsx yok), pazarlama bağlantısı yok.
export const metadata = { title: "Bağlantı geçersiz" };

export default function NotFound() {
  return (
    <PublicLinkNotFound
      icon={Share2}
      title="Paylaşım bağlantısı geçersiz"
      description="Bu paylaşım bağlantısının süresi dolmuş ya da kaldırılmış olabilir. İlanı size ileten ofisle iletişime geçin."
    />
  );
}
