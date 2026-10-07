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
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

/** Mobil navigasyon için Radix erişilebilirlik davranışlarını koruyan sol çekmece. */
export function DialogDrawerContent({
  children,
  className,
  responsiveClassName = "md:hidden",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  responsiveClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "dialog-overlay fixed inset-0 z-50 bg-ink-950/60 backdrop-blur-sm",
          responsiveClassName,
        )}
      />
      <DialogPrimitive.Content
        {...props}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[min(88vw,300px)] overflow-hidden shadow-[var(--shadow-lg)] outline-none",
          responsiveClassName,
          className,
        )}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

const sizeClass = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function DialogContent({
  children,
  className,
  overlayClassName,
  size = "lg",
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  size?: keyof typeof sizeClass;
  overlayClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "dialog-overlay fixed inset-0 z-50 overflow-y-auto bg-ink-950/55 p-4 backdrop-blur-md",
          overlayClassName,
        )}
      >
        <div className="flex min-h-full items-start justify-center sm:items-center">
          <DialogPrimitive.Content
            {...props}
            className={cn(
              // Modal en yüksek katman: elev-5 + üst iç ışık. Tek katmanlı
              // shadow-lg modalı arka plandan yeterince ayırmıyordu.
              "dialog-content w-full overflow-hidden rounded-[var(--radius-panel)] border border-white/20 bg-surface shadow-[var(--inner-top),var(--elev-5)]",
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
 * Fotoğraf galerisi, belge önizleme ve karşılaştırma gibi gerçekten tam
 * ekran yüzeyler için Radix davranışlarını koruyan içerik kabuğu.
 *
 * Tam ekran görünümü elle kurulmuş `role="dialog"` katmanlarıyla çözmek;
 * focus trap, arka planı inert yapma ve odağı tetikleyiciye döndürme gibi
 * kritik davranışları her tüketicide yeniden yazmaya zorluyordu. Bu primitive
 * aynı görsel serbestliği Radix'in modal sözleşmesiyle sunar.
 */
export function DialogFullscreenContent({
  children,
  className,
  overlayClassName,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "dialog-overlay fixed inset-0 z-[100] bg-ink-950/60 backdrop-blur-sm",
          overlayClassName,
        )}
      />
      <DialogPrimitive.Content
        {...props}
        className={cn(
          "fixed inset-0 z-[101] overflow-hidden outline-none",
          className,
        )}
      >
        {children}
      </DialogPrimitive.Content>
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
  tone = "default",
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** `danger`: yıkıcı/uyarı nitelikli işlemlerde ikon kutusu kırmızıya döner. */
  tone?: "default" | "danger";
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
            <span
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] [&_svg]:h-5 [&_svg]:w-5",
                tone === "danger"
                  ? "bg-danger-500/20 text-danger-300"
                  : "bg-white/10 text-mint-400",
              )}
            >
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
          className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-white/8 text-white/70 transition hover:bg-white/15 hover:text-white touch:h-11 touch:w-11"
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
