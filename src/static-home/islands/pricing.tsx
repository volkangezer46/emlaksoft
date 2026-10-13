import { createRoot } from "react-dom/client";
import { Pricing } from "@/components/pricing";
import type { ComponentProps } from "react";

/** Fiyat kartları adacığı: sunucu HTML'i yerine aynı bileşen çizilir (Preact, eşzamanlı → görünür titreme yok). */
export function mount(el: HTMLElement, props: ComponentProps<typeof Pricing>) {
  el.textContent = "";
  createRoot(el).render(<Pricing {...props} />);
}
