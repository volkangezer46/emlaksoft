"use client";

import { useEffect, useState, type ComponentType } from "react";
import { runWhenIdle } from "@/lib/idle";

/**
 * Kabukta her sayfada yüklenen ama nadiren açılan Radix gövdeleri (açılır menü, popover, çekmece) için ortak desen:
 * hafif düğme hemen çizilir; Radix gövdesi (`lazyPanel`) boşta önceden iner (isteğe bağlı) ve ilk etkileşimde
 * (tık, hover, odak, dokunma) açık gelir. `lazyPanel` parçası yüklüyse tık anında askıya alınmadan açılır.
 *
 * Kullanım: `const { Panel, open, warm } = useDeferredPanel(panel)`; `Panel` null iken hafif düğmeyi
 * (`onClick={open}`, `onPointerEnter/onFocus={warm}`) çiz, doluyken `<Panel initialOpen />` çiz.
 */
export function useDeferredPanel<P extends object>(
  panel: { preload: () => void; resolve: () => ComponentType<P> },
  options: { idle?: boolean } = {},
) {
  const { idle = true } = options;
  const [Panel, setPanel] = useState<ComponentType<P> | null>(null);
  useEffect(() => (idle ? runWhenIdle(panel.preload) : undefined), [panel, idle]);
  return {
    Panel,
    open: () => setPanel(() => panel.resolve()),
    warm: panel.preload,
  };
}
