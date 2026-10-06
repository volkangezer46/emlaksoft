"use client";

/**
 * Platform danışman sohbetinin TEMBEL kapısı: sohbet gövdesi (~600 satır istemci kodu, akış/indirme/kısayol
 * mantığı) sayfanın ilk paketinden çıkar; parça yalnız bu sayfada ve kabuk hazır olunca iner. `ssr: false`:
 * sohbet tamamen etkileşimli, sunucu HTML'inde yalnız aynı yükseklikte iskelet durur (düzen kayması yok).
 * Sunucu bileşeninden doğrudan `dynamic()` kod bölmediği için kapı bir istemci modülüdür (lazy-loading.md).
 */
import dynamic from "next/dynamic";
import { SkeletonPanel } from "@/components/ui/skeleton";

function ChatSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Danışman sohbeti yükleniyor">
      <SkeletonPanel rows={4} className="min-h-[32rem]" />
    </div>
  );
}

export const AdvisorChat = dynamic(() => import("./advisor-chat").then((m) => m.AdvisorChat), { ssr: false, loading: ChatSkeleton });
