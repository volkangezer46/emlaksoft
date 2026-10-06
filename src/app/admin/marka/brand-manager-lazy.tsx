"use client";

/**
 * Marka yöneticisinin TEMBEL kapısı: yükleme/önizleme/sıfırlama akışı ayrı parçaya bölünür; sunucu HTML'i
 * aynı kalır (`ssr` kapatılmadı), yalnız ilk JS paketi küçülür. Kapı istemci modülüdür (lazy-loading.md).
 */
import dynamic from "next/dynamic";
import { SkeletonPanel } from "@/components/ui/skeleton";

function BrandSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Marka yöneticisi yükleniyor" className="space-y-4">
      <SkeletonPanel rows={3} />
      <SkeletonPanel rows={3} />
    </div>
  );
}

export const BrandManager = dynamic(() => import("./brand-manager").then((m) => m.BrandManager), { loading: BrandSkeleton });
