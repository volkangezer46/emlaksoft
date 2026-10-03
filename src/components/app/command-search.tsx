"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { Command, Search } from "lucide-react";
import type { AppModule } from "@/lib/permissions";
import { OPEN_PALETTE_EVENT } from "@/lib/palette-core";

/**
 * Üst çubuk arama kutusu — hafif kabuk. Palet gövdesi (arama aksiyonu, hesap makinesi,
 * son kayıtlar, eylem listeleri) ilk etkileşime kadar yüklenmez: tık, Ctrl/Cmd+K veya
 * hover/odak (önceden ısıtma). Yüklenince gerçek bileşen aynı görünümlü kutuyu devralır.
 */
const loadPanel = () => import("./command-search-panel").then((m) => ({ default: m.CommandSearchPanel }));
const Panel = lazy(loadPanel);

function Trigger({ onOpen, onWarm }: { onOpen?: () => void; onWarm?: () => void }) {
  return (
    <div className="topbar-search relative min-w-0 shrink-0 sm:w-full sm:shrink">
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={onWarm}
        onFocus={onWarm}
        aria-expanded={false}
        aria-haspopup="listbox"
        aria-controls="app-command-results"
        aria-label="Müşteri, portföy, anlaşma, görev veya ilan ara"
        className="focus-ring relative flex shrink-0 items-center rounded-[var(--radius-control)] border border-hairline bg-canvas h-10 w-10 justify-center text-left text-sm text-text-faint shadow-[var(--elev-1)] transition hover:border-brand-300 hover:bg-surface hover:shadow-[var(--elev-2)] sm:h-auto sm:w-full sm:justify-start sm:py-2.5 sm:pl-10 sm:pr-20"
      >
        <Search className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-text-faint sm:left-3 sm:translate-x-0" aria-hidden />
        <span className="hidden truncate sm:inline">Müşteri, portföy, anlaşma, görev, ilan no ara…</span>
        <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1 text-xs text-text-faint sm:flex">
          <Command className="h-3 w-3" /> K
        </span>
      </button>
    </div>
  );
}

export function CommandSearch({
  accessibleModules,
  creatableModules,
  lockedHrefs,
  storageScope,
}: {
  accessibleModules: AppModule[];
  creatableModules?: AppModule[];
  lockedHrefs?: string[];
  storageScope?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [openOnMount, setOpenOnMount] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenOnMount(true);
        setMounted(true);
      }
    };
    const onOpen = () => {
      setOpenOnMount(true);
      setMounted(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [mounted]);

  if (!mounted) {
    return (
      <Trigger
        onOpen={() => {
          setOpenOnMount(true);
          setMounted(true);
        }}
        onWarm={() => void loadPanel()}
      />
    );
  }
  return (
    <Suspense fallback={<Trigger />}>
      <Panel accessibleModules={accessibleModules} creatableModules={creatableModules} lockedHrefs={lockedHrefs} initialOpen={openOnMount} storageScope={storageScope} />
    </Suspense>
  );
}
