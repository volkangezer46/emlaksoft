"use client";

import { Suspense, lazy, useEffect, useRef, type ComponentProps, type ComponentType } from "react";
import type { LeadForm } from "@/app/lead/[token]/lead-form";
import type { SavedSearchBox } from "@/components/public/saved-search-box";
import type { VitrinFilterPanel } from "./filter-panel";
import { createViewportGate } from "./viewport-gate";

/**
 * Vitrin istemci adaları: görünür alana yaklaşınca yüklenir (HIZ, SP7). Sunucu HTML'i HEMEN görünür (form yine GET ile
 * JS'siz çalışır); adanın istemci kodu, işaret elemanı görünür alana 600 px yaklaşana dek indirilmez/hidrate edilmez
 * (ana sayfa `pricing-deferred.tsx` ile aynı desen: React.lazy + IntersectionObserver; next/dynamic SSR'da parçayı
 * önceden yükleme listesine koyduğu için ertelemeyi bozar). Ana sayfadan farkı: aynı ada birden çok rotada kullanıldığı
 * için gözlem örnek başına yapılır (viewport-gate.ts). Davranış ve server action'lar değişmez.
 */

function deferred<P extends object>(anchorId: string, load: () => Promise<ComponentType<P>>) {
  // Kapı modül düzeyinde (tek lazy yükü); gözlem örnek başına (istemci gezinmesinde yeni eleman yeniden gözlenir).
  const gate = createViewportGate();
  const Lazy = lazy(async () => {
    await gate.released;
    return { default: await load() };
  });
  function Deferred(props: P) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => gate.watch(ref.current), []);
    // İşaret gerçek kutu olmalı (display:contents kutusuz kalır ve gözlemci hiç tetiklenmez).
    return (
      <div id={anchorId} ref={ref}>
        <Suspense fallback={null}>
          <Lazy {...props} />
        </Suspense>
      </div>
    );
  }
  return Deferred;
}

export const LazyLeadForm = deferred<ComponentProps<typeof LeadForm>>("vitrin-ada-talep", () =>
  import("@/app/lead/[token]/lead-form").then((m) => m.LeadForm),
);

export const LazySavedSearchBox = deferred<ComponentProps<typeof SavedSearchBox>>("vitrin-ada-arama", () =>
  import("@/components/public/saved-search-box").then((m) => m.SavedSearchBox),
);

export const LazyFilterPanel = deferred<ComponentProps<typeof VitrinFilterPanel>>("vitrin-ada-filtre", () =>
  import("./filter-panel").then((m) => m.VitrinFilterPanel),
);

/** Karşılaştırma çubuğu sabit konumludur; işaret ilan ızgarasının BAŞINDA (kartlar görünürken yüklenir). */
export const LazyCompareBar = deferred<Record<string, never>>("vitrin-ada-karsilastir", () =>
  import("@/components/public/compare-select").then((m) => m.CompareBar),
);
