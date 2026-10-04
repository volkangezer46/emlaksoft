"use client";

/**
 * Anlaşma panosunun TEMBEL kapısı.
 *
 * Sürükle-bırak kütüphanesi (`@dnd-kit/core`) yalnız `deal-board.tsx` ve `board-dnd.ts` içinde
 * kullanılır. Pano bu kapıdan yüklendiği için kütüphane ayrı bir parçaya (chunk) bölünür:
 * `?gorunum=liste` panoyu çizmez, dolayısıyla o parçayı da indirmez.
 *
 * Sunucu bileşeninden doğrudan `dynamic()` çağırmak kod bölmediği için (docs:
 * 01-app/02-guides/lazy-loading.md) kapı bir istemci modülü olmak ZORUNDA. `ssr` KAPATILMADI:
 * pano sunucu HTML'inde aynen çizilir (görünüm ve ilk boyama değişmez), yalnız JS parçası ayrılır.
 */

import dynamic from "next/dynamic";

/** Parça inerken (istemci içi geçişte) sütun düzenini tutan sakin iskelet: düzen kayması olmaz. */
function BoardSkeleton() {
  return (
    <div role="status" aria-label="Anlaşma panosu yükleniyor" aria-busy="true" className="flex gap-3 overflow-x-auto pb-2">
      {["new", "qualified", "negotiation", "won", "lost"].map((key) => (
        <div
          key={key}
          className="h-64 min-w-[260px] flex-1 rounded-[var(--radius-panel)] border border-line bg-line/60 motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}

export const DealBoard = dynamic(() => import("./deal-board").then((m) => m.DealBoard), { loading: BoardSkeleton });
