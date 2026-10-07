"use client";

import { RotateCcw, Save } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LEAVE_WARNING, createRowDraftStore, unsavedSummary } from "@/lib/ui/row-draft-store";
import { RowDraftStoreContext } from "@/lib/ui/use-row-draft";

/**
 * DraftTable — satır içi düzenlemeli tablonun sarmalayıcısı (satır içi kaydetme standardı).
 *  - Birden çok satır kirliyken tablonun üstünde yapışkan çubuk: "N satırda kaydedilmemiş değişiklik ·
 *    Tümünü kaydet · Tümünü geri al" (riskli satırlar kendi onay adımında bekler).
 *  - Kirli satır varken sayfadan ayrılma uyarısı: `beforeunload` + iç bağlantı tıklamasında onay.
 * Satırlar `useRowDraft` ile kendini bu depoya kaydeder; sarmalayıcı yoksa satırlar yine tek başına çalışır.
 */
export function DraftTable({ children, minDirtyForBar = 2 }: { children: ReactNode; minDirtyForBar?: number }) {
  const [store] = useState(createRowDraftStore);
  const count = useSyncExternalStore(store.subscribe, store.getCount, () => 0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (count === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // İç gezinme (Next <Link>): yakalama aşamasında aynı köken bağlantıları onaya bağlanır.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(LEAVE_WARNING)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [count]);

  return (
    <RowDraftStoreContext.Provider value={store}>
      {count >= minDirtyForBar ? (
        <div className="rs-bar" role="region" aria-label="Kaydedilmemiş değişiklikler">
          <span className="rs-unsaved">{count}</span>
          <span className="min-w-0 flex-1" aria-live="polite">
            {unsavedSummary(count)}
          </span>
          <Button size="sm" variant="navy" icon={Save} loading={pending} onClick={() =>
              startTransition(async () => {
                await store.saveAll();
              })
            }>
            Tümünü kaydet
          </Button>
          <Button size="sm" variant="outline" icon={RotateCcw} disabled={pending} onClick={() => store.resetAll()}>
            Tümünü geri al
          </Button>
        </div>
      ) : null}
      {children}
    </RowDraftStoreContext.Provider>
  );
}
