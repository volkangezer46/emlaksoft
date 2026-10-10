"use client";

import { Suspense, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { AppModule } from "@/lib/permissions";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";

/**
 * Üst çubuk "Yeni" hızlı eylem menüsü — hafif kabuk. Radix DropdownMenu gövdesi
 * ilk etkileşime (tık, hover, odak) kadar yüklenmez; yüklenince menü açık gelir.
 * (Desen: command-search.tsx.) "create" yetkili modüller sunucuda hesaplanıp prop gelir;
 * eylem listesi komut paletiyle aynı kaynaktan (palette-core APP_ACTIONS) beslenir.
 */
export type QuickCreateProps = { creatableModules: AppModule[]; lockedHrefs: string[] };

// Parça boşta önceden iner; tık anında yüklüyse askıya alınmadan açılır (`lazyPanel`).
const body = lazyPanel(() => import("./quick-create-menu-body").then((m) => m.QuickCreateMenuBody));

function Trigger({ onOpen, onWarm }: { onOpen?: () => void; onWarm?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={onWarm}
      onFocus={onWarm}
      aria-haspopup="menu"
      aria-expanded={false}
      className="focus-ring press inline-flex h-11 min-w-11 items-center justify-center gap-1.5 sm:h-10 rounded-[var(--radius-control)] bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700"
      aria-label="Hızlı yeni kayıt menüsü"
    >
      <Plus className="h-4 w-4" />
      <span className="hidden sm:inline">Yeni</span>
    </button>
  );
}

export function QuickCreateMenu({ creatableModules, lockedHrefs }: QuickCreateProps) {
  const [Body, setBody] = useState<ReturnType<typeof body.resolve> | null>(null);
  useEffect(() => runWhenIdle(body.preload), []);
  if (!Body) {
    return <Trigger onOpen={() => setBody(() => body.resolve())} onWarm={body.preload} />;
  }
  return (
    <Suspense fallback={<Trigger />}>
      <Body creatableModules={creatableModules} lockedHrefs={lockedHrefs} />
    </Suspense>
  );
}
