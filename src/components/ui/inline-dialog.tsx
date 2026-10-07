"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { INLINE_PANEL_HOST_ID } from "@/components/ui/inline-tabbed-panel";

/**
 * Sayfa içi "diyalog" — `@/components/ui/dialog` ile AYNI adlandırılmış API (Dialog, DialogTrigger,
 * DialogContent, DialogHeader, DialogBody, DialogFooter, DialogClose), ama POPUP YOK: overlay yok,
 * arka plan kilitlenmez. İçerik sayfanın üstündeki `#inline-panel-host` yuvasına (app layout'u) normal
 * akışta yerleşir ve görünüme kaydırılır; yuva yoksa bulunduğu yerde satır içi açılır
 * (`InlineTabbedPanel` ile aynı davranış). Esc ve "Kapat" ile kapanır, açılışta ilk alana odaklanır,
 * kapanışta odak tetikleyiciye döner. Geçiş: dosyada yalnız import yolu değişir.
 *
 * Onay soruları için `ConfirmDialog` (kısa evet/hayır) olduğu gibi kalır.
 */

type Ctx = {
  open: boolean;
  setOpen: (next: boolean) => void;
  contentId: string;
  titleId: string;
  /** Kapanışta odağın döneceği tetikleyiciyi kaydeder. */
  setTrigger: (el: HTMLElement | null) => void;
};

const DialogCtx = createContext<Ctx | null>(null);

function useDialogCtx(name: string): Ctx {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error(`${name} bir <Dialog> içinde kullanılmalı`);
  return ctx;
}

export function Dialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [inner, setInner] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? Boolean(openProp) : inner;
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();
  const titleId = useId();
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInner(next);
      onOpenChange?.(next);
      if (!next) {
        const t = triggerRef.current;
        if (t?.isConnected) t.focus({ preventScroll: true });
      }
    },
    [controlled, onOpenChange],
  );
  const setTrigger = useCallback((el: HTMLElement | null) => {
    triggerRef.current = el;
  }, []);
  const value = useMemo(() => ({ open, setOpen, contentId, titleId, setTrigger }), [open, setOpen, contentId, titleId, setTrigger]);
  return <DialogCtx.Provider value={value}>{children}</DialogCtx.Provider>;
}

type Clickable = ReactElement<{ onClick?: (e: ReactMouseEvent<HTMLElement>) => void; "aria-expanded"?: boolean; "aria-controls"?: string }>;

export function DialogTrigger({ asChild, children }: { asChild?: boolean; children: ReactNode }) {
  const ctx = useDialogCtx("DialogTrigger");
  const handle = (e: ReactMouseEvent<HTMLElement>) => {
    ctx.setTrigger(e.currentTarget);
    ctx.setOpen(!ctx.open);
  };
  if (asChild && isValidElement(children)) {
    const child = children as Clickable;
    return cloneElement(child, {
      "aria-expanded": ctx.open,
      "aria-controls": ctx.contentId,
      onClick: (e: ReactMouseEvent<HTMLElement>) => {
        child.props.onClick?.(e);
        if (!e.defaultPrevented) handle(e);
      },
    });
  }
  return (
    <button type="button" aria-expanded={ctx.open} aria-controls={ctx.contentId} onClick={handle}>
      {children}
    </button>
  );
}

export function DialogClose({ asChild, children, className, ...rest }: { asChild?: boolean; children?: ReactNode; className?: string; "aria-label"?: string }) {
  const ctx = useDialogCtx("DialogClose");
  if (asChild && isValidElement(children)) {
    const child = children as Clickable;
    return cloneElement(child, {
      onClick: (e: ReactMouseEvent<HTMLElement>) => {
        child.props.onClick?.(e);
        if (!e.defaultPrevented) ctx.setOpen(false);
      },
    });
  }
  return (
    <button type="button" className={className} onClick={() => ctx.setOpen(false)} {...rest}>
      {children}
    </button>
  );
}

const sizeClass = {
  sm: "max-w-xl",
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
} as const;

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled])';

export function DialogContent({
  children,
  className,
  size = "lg",
}: {
  children: ReactNode;
  className?: string;
  size?: keyof typeof sizeClass;
  /** Radix uyumluluğu için kabul edilir, kullanılmaz. */
  overlayClassName?: string;
  onOpenAutoFocus?: (e: Event) => void;
  onInteractOutside?: (e: Event) => void;
}) {
  const ctx = useDialogCtx("DialogContent");
  const ref = useRef<HTMLElement>(null);
  // Yuva yalnız açıkken aranır (InlineTabbedPanel deseni; sunucu çiziminde kapalıdır); yoksa satır içi kalır.
  const host = ctx.open && typeof document !== "undefined" ? document.getElementById(INLINE_PANEL_HOST_ID) : null;

  useEffect(() => {
    if (!ctx.open) return;
    const el = ref.current;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, [ctx.open, host]);

  if (!ctx.open) return null;

  const body = (
    <section
      ref={ref}
      id={ctx.contentId}
      role="region"
      aria-labelledby={ctx.titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          ctx.setOpen(false);
        }
      }}
      className={cn(
        "motion-enter mx-auto my-3 w-full overflow-hidden rounded-[var(--radius-panel)] border border-brand-300 bg-surface text-left shadow-[var(--elev-2)]",
        sizeClass[size],
        className,
      )}
    >
      {children}
    </section>
  );
  return host ? createPortal(body, host) : body;
}

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
  tone?: "default" | "danger";
  className?: string;
}) {
  const ctx = useDialogCtx("DialogHeader");
  return (
    <header className={cn("hairline-b flex items-start justify-between gap-4 px-4 py-4 md:px-6", className)}>
      <div className="flex items-center gap-3">
        {icon ? (
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] [&_svg]:h-5 [&_svg]:w-5",
              tone === "danger" ? "bg-danger-500/10 text-danger-600" : "bg-brand-50 text-brand-600",
            )}
          >
            {icon}
          </span>
        ) : null}
        <div>
          <h2 id={ctx.titleId} className="font-display text-base font-bold text-ink-950">
            {title}
          </h2>
          {description ? <p className="text-xs text-text-muted">{description}</p> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => ctx.setOpen(false)}
        aria-label="Paneli kapat"
        className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-surface-hover hover:text-ink-950"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </header>
  );
}

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  const ctx = useDialogCtx("DialogTitle");
  return (
    <h2 id={ctx.titleId} className={cn("font-display text-base font-bold text-ink-950", className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs text-text-muted", className)}>{children}</p>;
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-6", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4", className)}>
      {children}
    </div>
  );
}
