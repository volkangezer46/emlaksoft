"use client";

import dynamic from "next/dynamic";

/**
 * Public sayfalar icin tembel Combobox (paket butcesi): Radix Popover ilk boyamaya
 * girmez; yuklenirken ayni boyda bos bir kutu gosterilir (yerlesim kaymaz).
 */
export const LazyCombobox = dynamic(() => import("@/components/ui/combobox").then((m) => m.Combobox), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className="h-[2.625rem] w-full rounded-[var(--radius-card)] border border-line bg-canvas opacity-60"
    />
  ),
});
