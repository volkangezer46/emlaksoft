"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogDrawerContent, DialogTitleHidden } from "@/components/ui/dialog";

/**
 * Admin mobil menü çekmecesi (Radix Dialog gövdesi) — admin-sidebar.tsx tarafından ilk "Menü" dokunuşunda yüklenir
 * (masaüstü kabuk paketine Radix Dialog girmez). Focus trap, Escape ve scroll lock Radix'ten gelir; odak, açan
 * düğmeye `restoreFocusTo` ile döner (Dialog.Trigger olmadığı için elle). İçerik yalnız açıkken üretilir.
 */
export function AdminSidebarDrawer({
  open,
  onOpenChange,
  render,
  restoreFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  render: () => ReactNode;
  restoreFocusTo?: () => HTMLElement | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogDrawerContent
        id="admin-mobile-navigation"
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          const el = restoreFocusTo?.();
          if (el && el.isConnected) {
            e.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogTitleHidden>Admin menüsü</DialogTitleHidden>
        <DialogClose
          className="absolute right-3 top-[max(0.5rem,env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/80"
          aria-label="Kapat"
        >
          <X className="h-5 w-5" aria-hidden />
        </DialogClose>
        {render()}
      </DialogDrawerContent>
    </Dialog>
  );
}
