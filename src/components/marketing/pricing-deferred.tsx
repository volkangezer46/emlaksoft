"use client";

import { Suspense, lazy, type ComponentProps } from "react";
import type { Pricing } from "@/components/pricing";

type PricingProps = ComponentProps<typeof Pricing>;

/** Sunucu HTML'i hemen görünür; Pricing istemci kodu (~14 KB) bölüm görünür alana yaklaşana dek indirilmez/hidrate edilmez. */
const HYDRATE_ANCHOR_ID = "mk-price-hydrate"; // pricing-section.tsx içindeki sarmalayıcının id değeri

function whenNearViewport(id: string): Promise<void> {
  return new Promise((resolve) => {
    const el = typeof document === "undefined" ? null : document.getElementById(id);
    // Eleman yoksa (istemci gezinmesi, ilk render) beklemeden yükle; IntersectionObserver yoksa da hemen.
    if (!el || typeof IntersectionObserver === "undefined") return resolve();
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          resolve();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
  });
}

const PricingLazy = lazy(async () => {
  await whenNearViewport(HYDRATE_ANCHOR_ID);
  const m = await import("@/components/pricing");
  return { default: m.Pricing };
});

export function PricingDeferred(props: PricingProps) {
  return (
    <Suspense fallback={null}>
      <PricingLazy {...props} />
    </Suspense>
  );
}

