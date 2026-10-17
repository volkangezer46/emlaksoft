"use client";

import { usePathname } from "next/navigation";
import { financeTitleFor } from "./finance-title-logic";

/**
 * Finans kabuğunun başlığı (h1 metni) etkin alt alanı izler (WP3, tema P1-8): "Finans · Hareketler", "Finans · Kasa ve banka"…
 * Genel bakışta "Finans". Muhasebe (expenses) yetkisi olmayan kullanıcıda Finans genel bakışı kapalıdır; başlık yalnız alt
 * alanın adıdır ("Komisyon"), kapalı bir merkez adı yazılmaz. `usePathname` yalnız yol okur (Suspense gerektirmez).
 */
export function FinanceTitle({ hub }: { hub: boolean }) {
  return <>{financeTitleFor(usePathname(), hub)}</>;
}
