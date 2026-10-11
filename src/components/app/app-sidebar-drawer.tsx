"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden } from "@/components/ui/dialog";

/**
 * Mobil/tablet menü çekmecesi (Radix Dialog gövdesi) — app-sidebar.tsx tarafından ilk "Menü" dokunuşunda yüklenir
 * (masaüstü kabuk paketine Radix Dialog girmez). İçerik `render` ile yalnız çekmece AÇIKKEN (ve kapanış animasyonunda)
 * üretilir. Odak, açan düğmeye `restoreFocusTo` ile döner (Dialog.Trigger olmadığı için elle).
 */
export function AppSidebarDrawer({
  open,
  onOpenChange,
  responsiveClassName,
  render,
  restoreFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  responsiveClassName: string;
  render: () => ReactNode;
  restoreFocusTo?: () => HTMLElement | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogDrawerContent
        id="app-mobile-navigation"
        aria-describedby={undefined}
        responsiveClassName={responsiveClassName}
        onCloseAutoFocus={(e) => {
          const el = restoreFocusTo?.();
          if (el && el.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogTitleHidden>Panel menüsü</DialogTitleHidden>
        <aside className="sb-surface flex h-full min-h-0 flex-col pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]">
          <DialogClose
            className="absolute right-3 top-[max(0.5rem,env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" aria-hidden />
          </DialogClose>
          {render()}
        </aside>
      </DialogDrawerContent>
    </Dialog>
  );
}
