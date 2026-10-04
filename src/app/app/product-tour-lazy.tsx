"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppModule } from "@/lib/permissions";
import { tourIdForRole } from "@/lib/product-tour-data";
import { TOUR_PARAM, isTourDone } from "@/lib/product-tour-storage";

// Tur kodu (Radix Dialog dahil) yalnız tur gerçekten açılacaksa indirilir.
const ProductTour = dynamic(() => import("./product-tour").then((m) => m.ProductTour), { ssr: false });

/** Turun başlama ön koşulları (product-tour.tsx ile aynı): yalnız o zaman parçayı yükle. */
function shouldLoadTour(pathname: string, role: string): boolean {
  if (!role) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("tv") === "1" || pathname.startsWith("/app/pano-tv")) return false;
  if (params.get(TOUR_PARAM)) return true;
  if (pathname !== "/app") return false;
  if (isTourDone(tourIdForRole(role)) !== false) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Layout'ta bir kez bağlanır (turlar sayfalar arasında gezer). Rol ve erişilebilir modüller sunucudan gelir;
 * tur kodu yalnız gerektiğinde (ilk giriş ya da ?tur=) indirilir ve bir kez yüklenince açık kalır.
 */
export function ProductTourLazy({ role, accessible }: { role: string; accessible: readonly AppModule[] }) {
  const pathname = usePathname();
  const [load, setLoad] = useState(false);
  useEffect(() => {
    if (load || !shouldLoadTour(pathname, role)) return;
    const t = window.setTimeout(() => setLoad(true), 0);
    return () => window.clearTimeout(t);
  }, [pathname, role, load]);
  return load ? <ProductTour role={role} accessible={accessible} /> : null;
}
