"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AppModule } from "@/lib/permissions";
import { tourIdForRole } from "@/lib/product-tour-roles";
import { TOUR_PARAM, isTourDone, markServerSynced, markTourDone, needsServerSync } from "@/lib/product-tour-storage";
import { tourStateKey } from "@/lib/ui-state";
import { loadUiState, markUiState } from "@/app/actions/ui-state";
import { loadProductTours } from "@/app/actions/onboarding-content";
import type { TourDef } from "@/lib/product-tour-data";

// Tur kodu (Radix Dialog dahil) yalnız tur gerçekten açılacaksa indirilir.
const loadTourChunk = () => import("./product-tour").then((m) => m.ProductTour);
const ProductTour = dynamic(loadTourChunk, { ssr: false });

/**
 * Düzenlenmiş turlar sayfa ömründe bir kez istenir; tur parçasının indirilmesiyle PARALEL başlar (B039: eskiden 800 ms
 * bekleme + ardından sıralı istek). Hata = null (çalıştırıcı varsayılan turlarla devam eder).
 */
let toursRequest: Promise<TourDef[] | null> | null = null;
function requestTours(): Promise<TourDef[] | null> {
  toursRequest ??= loadProductTours().catch(() => null);
  return toursRequest;
}

type TourDecision = "load" | "ask-server" | "skip";

/** Profile aktarma sayfa ömründe tur başına bir kez denenir (salt-okunur rol yazamaz; her gezinmede yeniden istek atılmaz). */
const syncAttempted = new Set<string>();

/**
 * Turun başlama ön koşulları (product-tour.tsx ile aynı). `?tur=` açık istek → hemen yükle. Otomatik başlatma adayında
 * (ana ekran, yerel önbellekte görülmemiş) önce profile sorulur: başka cihazda görüldüyse tur açılmaz (YD5).
 */
function tourDecision(pathname: string, role: string): TourDecision {
  if (!role) return "skip";
  const params = new URLSearchParams(window.location.search);
  if (params.get("tv") === "1" || pathname.startsWith("/app/pano-tv")) return "skip";
  if (params.get(TOUR_PARAM)) return "load";
  if (pathname !== "/app") return "skip";
  if (isTourDone(tourIdForRole(role)) !== false) return "skip";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "skip";
  return "ask-server";
}

/**
 * Layout'ta bir kez bağlanır (turlar sayfalar arasında gezer). Rol ve erişilebilir modüller sunucudan gelir;
 * tur kodu yalnız gerektiğinde (ilk giriş ya da ?tur=) indirilir ve bir kez yüklenince açık kalır.
 * Profil sorgusu yalnız yerel önbellekte "görülmedi" iken (yeni cihaz/tarayıcı) yapılır; her gezinmede istek atılmaz.
 */
export function ProductTourLazy({ role, accessible }: { role: string; accessible: readonly AppModule[] }) {
  const pathname = usePathname();
  const [load, setLoad] = useState(false);
  useEffect(() => {
    if (load) return;
    const id = tourIdForRole(role);
    // Eski cihazda yerelde görülmüş tur profile bir kez aktarılır (sonraki yeni cihazlar sormadan bilir).
    if (role && !syncAttempted.has(id) && needsServerSync(id)) {
      syncAttempted.add(id);
      void markUiState(tourStateKey(id))
        .then((r) => {
          if (r.ok) markServerSynced(id);
        })
        .catch(() => {});
    }
    const decision = tourDecision(pathname, role);
    if (decision === "skip") return;
    let cancelled = false;
    // Tur parçası karar beklenmeden indirilmeye başlar (önbellekte hazır olsun).
    void loadTourChunk().catch(() => {});
    if (decision === "load") {
      void requestTours();
      const t = window.setTimeout(() => setLoad(true), 0);
      return () => window.clearTimeout(t);
    }
    void loadUiState()
      .then((state) => {
        if (cancelled) return;
        const seenAt = state?.[tourStateKey(id)];
        if (seenAt) {
          // Başka cihazda görülmüş: yerel önbelleğe yaz, turu açma.
          markTourDone(id, seenAt);
          markServerSynced(id);
          return;
        }
        void requestTours();
        setLoad(true);
      })
      .catch(() => {
        if (cancelled) return;
        void requestTours();
        setLoad(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, role, load]);
  return load ? <ProductTour role={role} accessible={accessible} toursRequest={toursRequest ?? undefined} /> : null;
}
