"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import Link from "@/components/ui/smart-link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogDescription, DialogSheetContent, DialogTitle } from "@/components/ui/dialog";
import type { PaletteEntry } from "@/lib/palette-core";
import { SHEET_ROW_CLASS, splitNewActions } from "@/components/app/mobile-new-sheet";
import { useSimpleMode } from "@/lib/simple-mode";

/** Aşağı kaydırma bu kadar pikseli (ya da hızlı fiske eşiğini) geçerse sayfa kapanır. */
export const SHEET_CLOSE_DISTANCE = 80;
/** px/ms: kısa ama hızlı aşağı fiske de kapatır. */
export const SHEET_CLOSE_VELOCITY = 0.5;

/** Bırakılan sürükleme sayfayı kapatsın mı? `dy`: aşağı yönde piksel, `ms`: süre. */
export function shouldCloseSheet(dy: number, ms: number): boolean {
  if (dy <= 0) return false;
  return dy >= SHEET_CLOSE_DISTANCE || (dy >= 24 && dy / Math.max(ms, 1) >= SHEET_CLOSE_VELOCITY);
}

/**
 * Alt sayfayı aşağı sürükleyerek kapatma (WP1). Yalnız dokunma/kalem ve yalnız tutamaç + başlık bölgesinden (`handlers`;
 * `touch-none`): eylem listesinin kendi kaydırmasıyla çakışmaz. Sürüklerken sayfa (`ref`) parmağı izler, bırakınca eşiği
 * geçtiyse kapanır, geçmediyse yerine döner.
 */
function useSwipeDown(ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const drag = useRef<{ id: number; y: number; t: number; dy: number } | null>(null);
  const setY = (y: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? "transform var(--motion-fast, 160ms) var(--ease-out, ease-out)" : "none";
    el.style.transform = y > 0 ? `translateY(${y}px)` : "";
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!cancelled && shouldCloseSheet(d.dy, performance.now() - d.t)) onClose();
    else setY(0, true);
  };
  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse") return;
      drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      d.dy = Math.max(0, e.clientY - d.y);
      setY(d.dy, false);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => end(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => end(e, true),
  };
  return handlers;
}

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
  const sheetRef = useRef<HTMLDivElement>(null);
  const swipe = useSwipeDown(sheetRef, () => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSheetContent ref={sheetRef} aria-describedby="mobile-new-desc">
        {/* Sürükleme bölgesi: tutamaç + başlık (`touch-none`: dikey sürükleme sayfa kaydırması değil, kapatma hareketi). */}
        <div {...swipe} className="touch-none">
        {/* Tutamaç (WP1): aşağı sürükleyerek kapatılabildiğini gösterir; süs, odak almaz. */}
        <div aria-hidden className="flex justify-center pt-2">
          <span className="h-1.5 w-10 rounded-full bg-line-strong" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-2">
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
