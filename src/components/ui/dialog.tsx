"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Dialog — Radix tabanlı, EmlakSoft tasarım diline bağlı.
 *
 * Radix'ten gelen bedava kazanımlar: focus trap, Esc ile kapatma, scroll lock,
 * `aria-modal` + başlık/açıklama ilişkilendirme, focus'un tetikleyiciye dönmesi.
 * Görünüm tamamen bizim token'larımız (--grad-ink, --shadow-lg, --radius-*).
 *
 * Kullanım:
 *   <Dialog>
 *     <DialogTrigger asChild><button>Aç</button></DialogTrigger>
 *     <DialogContent size="lg">
 *       <DialogHeader icon={<ListPlus />} title="Yeni görev" description="…" />
 *       <DialogBody>…</DialogBody>
 *       <DialogFooter>…</DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const sizeClass = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function DialogContent({
  children,
  className,
  size = "lg",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  size?: keyof typeof sizeClass;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 overflow-y-auto bg-ink-950/55 p-4 backdrop-blur-md">
        <div className="flex min-h-full items-start justify-center sm:items-center">
          <DialogPrimitive.Content
            {...props}
            className={cn(
              // Modal en yüksek katman: elev-5 + üst iç ışık. Tek katmanlı
              // shadow-lg modalı arka plandan yeterince ayırmıyordu.
              "dialog-content w-full overflow-hidden rounded-[22px] border border-white/20 bg-surface shadow-[var(--inner-top),var(--elev-5)]",
              sizeClass[size],
              className,
            )}
          >
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
}

/**
 * Koyu gradient başlık — panel genelindeki dialog başlıklarıyla birebir aynı.
 * `Title` ve `Description` Radix'e bağlı olduğu için ekran okuyucu dialog'u
 * doğru okur (aria-labelledby / aria-describedby otomatik kurulur).
 */
export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] px-6 py-5 text-white",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {icon ? (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-white/10 text-mint-400 [&_svg]:h-5 [&_svg]:w-5">
              {icon}
            </span>
          ) : null}
          <div>
            <DialogPrimitive.Title className="font-display text-lg font-bold text-white">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-xs text-white/55">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
        </div>
        <DialogPrimitive.Close
          className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-white/8 text-white/70 transition hover:bg-white/15 hover:text-white"
          aria-label="Kapat"
        >
          <X className="h-5 w-5" />
        </DialogPrimitive.Close>
      </div>
    </div>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-6", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Başlığı gizli tutmak gerektiğinde (ör. komut paleti) erişilebilirlik için. */
export function DialogTitleHidden({ children }: { children: ReactNode }) {
  return (
    <DialogPrimitive.Title className="sr-only">{children}</DialogPrimitive.Title>
  );
}
