"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ComponentProps, ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * InlinePanel — sayfa içi kalıcı ekleme paneli.
 *
 * Oluşturma formları için modal yerine: listenin üstünde genişleyen bir kart.
 * Arka planı kilitlemez, URL'i değiştirmez; Esc veya "Kapat" ile kapanır,
 * açılışta ilk alana odaklanır, kapanışta odak tetikleyiciye döner.
 *
 * Tetikleyici ile panel sayfada farklı yerlerde durabilir (hero'daki buton,
 * listenin üstündeki panel); ikisi aynı `id` ile modül düzeyinde küçük bir
 * store üzerinden eşleşir. Aynı id'ye birden çok tetikleyici bağlanabilir.
 *
 * Kullanım:
 *   <InlinePanelTrigger panelId="gider-ekle" icon={Plus}>Gider ekle</InlinePanelTrigger>
 *   <InlinePanel id="gider-ekle" title="Yeni gider" icon={<Plus />}>
 *     {(close) => <form>…</form>}
 *   </InlinePanel>
 */

const openIds = new Set<string>();
const listeners = new Set<() => void>();
const triggers = new Map<string, HTMLElement | null>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInlinePanel(id: string) {
  const open = useSyncExternalStore(
    subscribe,
    () => openIds.has(id),
    () => false,
  );
  const openPanel = useCallback(
    (from?: HTMLElement | null) => {
      if (from !== undefined) triggers.set(id, from);
      openIds.add(id);
      emit();
    },
    [id],
  );
  const close = useCallback(() => {
    if (!openIds.delete(id)) return;
    emit();
    const trigger = triggers.get(id);
    if (trigger?.isConnected) trigger.focus();
  }, [id]);
  const toggle = useCallback(
    (from?: HTMLElement | null) => {
      if (openIds.has(id)) close();
      else openPanel(from);
    },
    [id, close, openPanel],
  );
  return { open, openPanel, close, toggle };
}

export function InlinePanelTrigger({
  panelId,
  onClick,
  children,
  ...props
}: { panelId: string } & ComponentProps<typeof Button>) {
  const { open, toggle } = useInlinePanel(panelId);
  return (
    <Button
      aria-expanded={open}
      aria-controls={panelId}
      onClick={(e) => {
        onClick?.(e);
        toggle(e.currentTarget);
      }}
      {...props}
    >
      {children}
    </Button>
  );
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="combobox"]:not([disabled])';

export function InlinePanel({
  id,
  title,
  description,
  icon,
  className,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
  /** Çocuk bir fonksiyonsa panelin kapatma fonksiyonunu alır (başarıda kapatmak için). */
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const { open, close } = useInlinePanel(id);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  return (
    <section
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          close();
        }
      }}
      className={cn(
        "overflow-hidden rounded-[var(--radius-panel)] border border-brand-300 bg-surface shadow-[var(--elev-2)]",
        className,
      )}
    >
      <header className="hairline-b flex items-start justify-between gap-4 px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          {icon ? (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-50 text-brand-600 [&_svg]:h-5 [&_svg]:w-5">
              {icon}
            </span>
          ) : null}
          <div>
            <h2 id={`${id}-title`} className="font-display text-base font-bold text-ink-950">
              {title}
            </h2>
            {description ? <p className="text-xs text-text-muted">{description}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Paneli kapat"
          className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-canvas hover:text-ink-950"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>
      {typeof children === "function" ? children(close) : children}
    </section>
  );
}
