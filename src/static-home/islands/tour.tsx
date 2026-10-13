import { createRoot } from "react-dom/client";
import { CLIENT_SCREENS } from "@/components/marketing/product-tour/screens-client";
import type { TourItem } from "@/lib/site-content/schema";

/** Ürün turunun görünmeyen ekranları (2..N): yer tutucuların (data-tour) yerine aynı SVG bileşenleri çizilir. */
export function mount(placeholders: HTMLElement[]) {
  for (const ph of placeholders) {
    const Screen = CLIENT_SCREENS[ph.dataset.tour as TourItem["id"]];
    if (!Screen) continue;
    const host = document.createElement("div");
    host.style.display = "contents";
    ph.replaceWith(host);
    createRoot(host).render(<Screen />);
  }
}
