"use client";

import { Suspense, useEffect, useState, type ComponentType } from "react";
import type { PlatformModule } from "@/lib/platform-access";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";
import { OPEN_PALETTE_EVENT } from "@/lib/palette-events";
import { PaletteTrigger } from "./command-palette-trigger";

type PaletteProps = { modules: PlatformModule[]; initialOpen?: boolean };

// Palet gövdesi (arama, sonuç listesi, menü komutları) ilk yük paketine girmez: boşta önceden iner; ⌘K, düğme ya da
// açma olayı geldiğinde yüklüyse AYNI karede açık bağlanır (`lazyPanel`), değilse yüklenir yüklenmez açılır.
const panel = lazyPanel<PaletteProps>(() => import("./command-palette").then((m) => m.CommandPalette));

/**
 * Yönetim üst çubuğu arama kutusu — hafif kabuk. Gövde bağlandıktan sonra ⌘K (aç/kapa), Esc ve açma olayı tamamen
 * gövdededir; kabuk yalnız İLK açılışı yakalar (ilk ⌘K basışı da paleti açar).
 */
export function CommandPaletteLazy({ modules }: { modules: PlatformModule[] }) {
  const [Body, setBody] = useState<ComponentType<PaletteProps> | null>(null);
  const mount = () => setBody(() => panel.resolve());

  useEffect(() => runWhenIdle(panel.preload), []);
  useEffect(() => {
    if (Body) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBody(() => panel.resolve());
      }
    };
    const onOpen = () => setBody(() => panel.resolve());
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [Body]);

  const trigger = (
    <div className="relative w-full">
      <PaletteTrigger open={false} onOpen={mount} onWarm={panel.preload} />
    </div>
  );
  if (!Body) return trigger;
  return (
    <Suspense fallback={trigger}>
      <Body modules={modules} initialOpen />
    </Suspense>
  );
}
