import { createRoot } from "react-dom/client";
import { FeaturedPreview, SCENE_COPY } from "@/components/site-menu/featured-preview";
import type { SceneKind } from "@/lib/site-menu/previews";

export { SCENE_COPY };

/** Mega menü canlı önizleme sahneleri: her katmana (data-kind) sahnesi çizilir; kart metinleri SCENE_COPY'den. */
export function mount(layers: HTMLElement[]) {
  for (const layer of layers) {
    if (layer.dataset.mounted) continue;
    layer.dataset.mounted = "1";
    createRoot(layer).render(<FeaturedPreview kind={layer.dataset.kind as SceneKind} label={layer.dataset.label || undefined} />);
  }
}
