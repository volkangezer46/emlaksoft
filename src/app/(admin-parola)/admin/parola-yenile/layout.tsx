import { Suspense } from "react";
import { ConsoleMonoFont } from "@/components/ui/console/mono-font";
import { RouteSplash } from "@/components/route-splash";
import { IconSprite } from "@/components/ui/icon-sprite";
import "@/app/console-base.css";
import "@/app/console.css";
import "@/app/console-premium.css";

/**
 * Zorunlu parola değişimi ekranının çerçevesi: yönetim kabuğu (`src/app/admin/layout.tsx`) DIŞINDA, aynı yazı tipi,
 * ikon sprite'ı, konsol stilleri ve yükleme splash'i. Rota grubu `(admin-parola)` yolu değiştirmez: adres
 * /admin/parola-yenile'dir (proxy'de /admin kapısından geçer); kabuk ve parola formu birbirinin paketine girmez.
 */
export default function ForcedPasswordLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleMonoFont>
      <IconSprite />
      <Suspense fallback={<RouteSplash />}>{children}</Suspense>
    </ConsoleMonoFont>
  );
}
