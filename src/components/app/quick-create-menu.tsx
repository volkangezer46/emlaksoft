"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { QUICK_CREATE_TRIGGER_CLASS } from "./quick-create-trigger";
import type { AppModule } from "@/lib/permissions";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";

/**
 * Üst çubuk "Yeni" hızlı eylem menüsü — hafif kabuk. Radix DropdownMenu gövdesi
 * ilk etkileşime (tık, hover, odak) kadar yüklenmez; yüklenince menü açık gelir.
 * (Desen: command-search.tsx.) "create" yetkili modüller sunucuda hesaplanıp prop gelir;
 * eylem listesi komut paletiyle aynı kaynaktan (palette-core APP_ACTIONS) beslenir.
 */
export type QuickCreateProps = { creatableModules: AppModule[]; lockedHrefs: string[]; role?: string | null };

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
      className={QUICK_CREATE_TRIGGER_CLASS}
      aria-label="Hızlı ekle menüsü"
    >
      <Plus className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Yeni</span>
      <span className="qc-sep hidden sm:block" aria-hidden />
      <ChevronDown className="hidden h-4 w-4 opacity-80 sm:block" aria-hidden />
    </button>
  );
}

/**
 * Ana sayfada (/app) çizilmez: kahramanın rol bazlı hızlı işlemleri ("Yeni ilan · Yeni müşteri · … ⋯") aynı eylemleri
 * taşır; aynı eylem iki yerde olmaz (sahip kuralı 2026-10-17). Diğer sayfalarda tam "Yeni" menüsü.
 */
export function QuickCreateMenu({ creatableModules, lockedHrefs, role = null }: QuickCreateProps) {
  const [Body, setBody] = useState<ReturnType<typeof body.resolve> | null>(null);
  const onHome = usePathname() === "/app";
  useEffect(() => runWhenIdle(body.preload), []);
  if (onHome) return null;
  if (!Body) {
    return <Trigger onOpen={() => setBody(() => body.resolve())} onWarm={body.preload} />;
  }
  return (
    <Suspense fallback={<Trigger />}>
      <Body creatableModules={creatableModules} lockedHrefs={lockedHrefs} role={role} />
    </Suspense>
  );
}
