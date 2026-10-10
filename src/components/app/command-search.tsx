"use client";

import { Suspense, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { ShortcutHint } from "./shortcut-hint";
import type { AppModule } from "@/lib/permissions";
import { OPEN_PALETTE_EVENT, paletteQueryFromEvent } from "@/lib/palette-core";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";

/**
 * Üst çubuk arama kutusu — hafif kabuk. Palet gövdesi (arama aksiyonu, hesap makinesi,
 * son kayıtlar, eylem listeleri) ilk etkileşime kadar yüklenmez: tık, Ctrl/Cmd+K veya
 * hover/odak (önceden ısıtma) ve sayfa boşalınca arka planda. Yüklenince gerçek bileşen aynı görünümlü
 * kutuyu devralır; parça önceden indiyse askıya alınmadan açılır (`lazyPanel`).
 */
const panel = lazyPanel(() => import("./command-search-panel").then((m) => m.CommandSearchPanel));

function Trigger({ onOpen, onWarm }: { onOpen?: () => void; onWarm?: () => void }) {
  return (
    <div className="topbar-search relative min-w-0 shrink-0 sm:w-full sm:shrink">
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={onWarm}
        onFocus={onWarm}
        aria-expanded={false}
        data-tour="arama"
        aria-haspopup="listbox"
        aria-controls="app-command-results"
        aria-label="Müşteri, portföy, anlaşma, görev veya ilan ara"
        className="focus-ring relative flex shrink-0 items-center rounded-[var(--radius-control)] border border-hairline bg-canvas h-11 w-11 justify-center text-left text-sm text-text-faint shadow-[var(--elev-1)] transition hover:border-brand-300 hover:bg-surface hover:shadow-[var(--elev-2)] sm:h-auto sm:w-full sm:justify-start sm:py-2.5 sm:pl-10 sm:pr-20"
      >
        <Search className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-text-faint sm:left-3 sm:translate-x-0" aria-hidden />
        <span className="hidden truncate sm:inline">Ad, telefon veya ilan no yazın…</span>
        <ShortcutHint className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-md border border-hairline bg-surface px-2 py-1 font-sans text-xs text-text-faint sm:block" />
      </button>
    </div>
  );
}

export function CommandSearch({
  accessibleModules,
  creatableModules,
  lockedHrefs,
  storageScope,
  uiPrefCookie,
}: {
  accessibleModules: AppModule[];
  creatableModules?: AppModule[];
  lockedHrefs?: string[];
  storageScope?: string;
  uiPrefCookie?: string | null;
}) {
  const [Panel, setPanel] = useState<ReturnType<typeof panel.resolve> | null>(null);
  const mounted = Panel !== null;
  const [openOnMount, setOpenOnMount] = useState(false);
  // Dışarıdan (ana ekran kutusu) gelen başlangıç metni: palet parçası inince panele iletilir.
  const [initialQuery, setInitialQuery] = useState("");

  // Sayfa boşalınca palet parçasını arka planda indir: ilk Ctrl+K / tık beklemesin.
  useEffect(() => runWhenIdle(panel.preload), []);

  useEffect(() => {
    if (mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenOnMount(true);
        setPanel(() => panel.resolve());
      }
    };
    const onOpen = (e: Event) => {
      setInitialQuery(paletteQueryFromEvent(e));
      setOpenOnMount(true);
      setPanel(() => panel.resolve());
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, [mounted]);

  if (!Panel) {
    return (
      <Trigger
        onOpen={() => {
          setOpenOnMount(true);
          setPanel(() => panel.resolve());
        }}
        onWarm={panel.preload}
      />
    );
  }
  return (
    <Suspense fallback={<Trigger />}>
      <Panel accessibleModules={accessibleModules} creatableModules={creatableModules} lockedHrefs={lockedHrefs} initialOpen={openOnMount} initialQuery={initialQuery} storageScope={storageScope} uiPrefCookie={uiPrefCookie} />
    </Suspense>
  );
}
