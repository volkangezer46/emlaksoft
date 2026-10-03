"use client";

import { lazy, Suspense, useState } from "react";
import { Plus } from "lucide-react";
import type { AppModule } from "@/lib/permissions";

/**
 * Üst çubuk "Yeni" hızlı eylem menüsü — hafif kabuk. Radix DropdownMenu gövdesi
 * ilk etkileşime (tık, hover, odak) kadar yüklenmez; yüklenince menü açık gelir.
 * (Desen: command-search.tsx.) "create" yetkili modüller sunucuda hesaplanıp prop gelir;
 * eylem listesi komut paletiyle aynı kaynaktan (palette-core APP_ACTIONS) beslenir.
 */
export type QuickCreateProps = { creatableModules: AppModule[]; lockedHrefs: string[] };

const loadBody = () => import("./quick-create-menu-body").then((m) => ({ default: m.QuickCreateMenuBody }));
const Body = lazy(loadBody);

function Trigger({ onOpen, onWarm }: { onOpen?: () => void; onWarm?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={onWarm}
      onFocus={onWarm}
      aria-haspopup="menu"
      aria-expanded={false}
      className="focus-ring press inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700"
      aria-label="Hızlı yeni kayıt menüsü"
    >
      <Plus className="h-4 w-4" />
      <span className="hidden sm:inline">Yeni</span>
    </button>
  );
}

export function QuickCreateMenu({ creatableModules, lockedHrefs }: QuickCreateProps) {
  const [mounted, setMounted] = useState(false);
  if (!mounted) {
    return <Trigger onOpen={() => setMounted(true)} onWarm={() => void loadBody()} />;
  }
  return (
    <Suspense fallback={<Trigger />}>
      <Body creatableModules={creatableModules} lockedHrefs={lockedHrefs} />
    </Suspense>
  );
}
