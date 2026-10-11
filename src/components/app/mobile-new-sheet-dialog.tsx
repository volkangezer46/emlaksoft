"use client";

import Link from "@/components/ui/smart-link";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogDescription, DialogSheetContent, DialogTitle } from "@/components/ui/dialog";
import type { PaletteEntry } from "@/lib/palette-core";
import { SHEET_ROW_CLASS } from "@/components/app/mobile-new-sheet";

/** "+ Yeni" eylem sayfası (Radix Dialog gövdesi) — app-sidebar.tsx tarafından ilk dokunuşta yüklenir. */
export function MobileNewSheet({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: readonly PaletteEntry[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSheetContent aria-describedby="mobile-new-desc">
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <DialogTitle className="font-display text-lg font-bold text-ink-950">Ne eklemek istiyorsun?</DialogTitle>
            <DialogDescription id="mobile-new-desc" className="text-sm text-text-muted">
              Bir seçim yap, form açılsın.
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
          {actions.map((a) => (
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
      </DialogSheetContent>
    </Dialog>
  );
}
