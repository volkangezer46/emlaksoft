import { createRoot } from "react-dom/client";
import SeatCalculator from "@/components/pricing-page/seat-calculator";
import type { ComponentProps } from "react";

/** Koltuk hesaplayıcı adacığı (Next sürümünde de yalnız istemcide çizilir: ssr:false). İskeletin yerine çizilir. */
export function mount(el: HTMLElement, props: ComponentProps<typeof SeatCalculator>) {
  el.textContent = "";
  createRoot(el).render(<SeatCalculator {...props} />);
}
