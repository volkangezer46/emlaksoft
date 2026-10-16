"use client";

import { useLayoutEffect, useState } from "react";
import Link from "@/components/ui/smart-link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogSheetContent, DialogTitle } from "@/components/ui/dialog";
import type { PaletteEntry } from "@/lib/palette-core";
import { SHEET_ROW_CLASS, splitNewActions } from "@/components/app/mobile-new-sheet";
import { useSimpleMode } from "@/lib/simple-mode";

/**
 * "+ Yeni" eylem sayfası (Radix Dialog gövdesi) — app-sidebar.tsx tarafından ilk dokunuşta yüklenir. `onShown`: gövde açık
 * bağlandığı commit'te (boyamadan ÖNCE) çağrılır; dokunma örtüsü (B032, tap-veil.ts) aynı karede kalkar.
 */
export function MobileNewSheet({
  open,
  onOpenChange,
  actions,
  onShown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly PaletteEntry[];
  onShown?: () => void;
}) {
  useLayoutEffect(() => {
    if (open) onShown?.();
  }, [open, onShown]);
  // Sade modda 6 sık eylem; kalanı "Tümünü göster" ile açılır (hiçbir eylem silinmez).
  const { primary, rest } = splitNewActions(actions, useSimpleMode());
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? [...primary, ...rest] : primary;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSheetContent aria-describedby="mobile-new-desc">
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg font-bold text-ink-950">Ne eklemek istiyorsunuz?</DialogTitle>
            <DialogDescription id="mobile-new-desc" className="text-sm text-text-muted">
              Bir seçim yapın, form açılsın.
            </DialogDescription>
          </div>
          <DialogClose
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-hover"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" aria-hidden />
          </DialogClose>
        </div>
        <ul className="grid grid-cols-2 gap-2 px-4 pb-2">
          {shown.map((a) => (
            <li key={a.href}>
              <Link href={a.href} onClick={() => onOpenChange(false)} className={SHEET_ROW_CLASS}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                  <a.icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">{a.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        {rest.length > 0 && !showAll ? (
          <div className="px-4 pb-2">
            <Button variant="ghost" onClick={() => setShowAll(true)} className="min-h-11 w-full">
              Tümünü göster ({rest.length})
            </Button>
          </div>
        ) : null}
      </DialogSheetContent>
    </Dialog>
  );
}
