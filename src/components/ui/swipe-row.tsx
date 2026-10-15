"use client";

import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SwipeAction = {
  label: string;
  icon: LucideIcon;
  tone: "success" | "warning" | "brand";
  onAction: () => void;
};

/** Eşik: satır genişliğinin %35'i (en az 72 px). */
const THRESHOLD_RATIO = 0.35;
const MIN_THRESHOLD = 72;
/** Yatay niyet: bu kadar hareketten sonra yön kararı verilir. */
const INTENT_PX = 10;

const TONE: Record<SwipeAction["tone"], string> = {
  success: "bg-mint-500 text-white",
  warning: "bg-amber-500 text-white",
  brand: "bg-brand-600 text-white",
};

function vibrate() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
  } catch {
    /* desteklenmiyor */
  }
}

type Track = { id: number; x: number; y: number; width: number; decided: "x" | "y" | null; armed: boolean };

/**
 * GA-10 mobil kaydırma eylemi (kütüphanesiz, pointer events). YALNIZ dokunmatik işaretçide etkin (fare/kalemle
 * hiçbir şey olmaz); `touch-action: pan-y` ile dikey kaydırma bozulmaz — yatay niyet belirlenince satır kayar.
 * Sağa kaydırma = birincil (`right`, ör. Tamamla), sola = ikincil (`left`, ör. Yarın). Eşik geçilince kısa titreşim
 * (destekleyen cihazda) ve renkli zemin dolar; bırakınca eylem çalışır. Aynı eylemler satırdaki görünür düğmelerde de
 * durur (ekran okuyucu ve klavye için). `prefers-reduced-motion` açıkken geri dönüş animasyonsuzdur.
 */
export function SwipeRow({
  left,
  right,
  disabled = false,
  className,
  children,
}: {
  left?: SwipeAction | null;
  right?: SwipeAction | null;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(320);
  const track = useRef<Track | null>(null);
  const swiped = useRef(false);
  const active = !disabled && Boolean(left || right);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!active || e.pointerType !== "touch") return;
    track.current = { id: e.pointerId, x: e.clientX, y: e.clientY, width: e.currentTarget.offsetWidth || 320, decided: null, armed: false };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const t = track.current;
    if (!t || t.id !== e.pointerId) return;
    const mx = e.clientX - t.x;
    const my = e.clientY - t.y;
    if (!t.decided) {
      if (Math.abs(mx) < INTENT_PX && Math.abs(my) < INTENT_PX) return;
      t.decided = Math.abs(mx) > Math.abs(my) * 1.2 ? "x" : "y";
      if (t.decided === "y") {
        track.current = null;
        return;
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* yok say */
      }
      setDragging(true);
      setWidth(t.width);
    }
    // Eylemi olmayan yöne kaydırılmaz (direnç).
    const next = mx > 0 ? (right ? mx : mx / 6) : left ? mx : mx / 6;
    const threshold = Math.max(MIN_THRESHOLD, t.width * THRESHOLD_RATIO);
    const armed = Math.abs(next) >= threshold && Boolean(next > 0 ? right : left);
    if (armed !== t.armed) {
      t.armed = armed;
      if (armed) vibrate();
    }
    setDx(next);
  }

  function finish(cancelled: boolean) {
    const t = track.current;
    track.current = null;
    setDragging(false);
    const current = dx;
    setDx(0);
    if (!t || t.decided !== "x") return;
    swiped.current = true;
    window.setTimeout(() => (swiped.current = false), 0);
    if (cancelled || !t.armed) return;
    const action = current > 0 ? right : left;
    action?.onAction();
  }

  // Kaydırma sonrası "tıklama" satırdaki bağlantıyı açmasın.
  function onClickCapture(e: ReactMouseEvent<HTMLDivElement>) {
    if (swiped.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  if (!active) return <div className={className}>{children}</div>;

  const shown = dx > 0 ? right : dx < 0 ? left : null;
  const Icon = shown?.icon;
  const armed = Math.abs(dx) >= Math.max(MIN_THRESHOLD, width * THRESHOLD_RATIO);

  return (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-card)]", className)}>
      {shown && Icon ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center px-5 text-sm font-bold transition-opacity",
            TONE[shown.tone],
            dx > 0 ? "justify-start" : "justify-end",
            armed ? "opacity-100" : "opacity-70",
          )}
        >
          <span className="flex items-center gap-2">
            <Icon className={cn("h-5 w-5 transition-transform motion-reduce:transition-none", armed ? "scale-110" : "scale-90")} />
            {shown.label}
          </span>
        </div>
      ) : null}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => finish(false)}
        onPointerCancel={() => finish(true)}
        onClickCapture={onClickCapture}
        className={cn("relative", dragging ? "" : "transition-transform duration-200 ease-out motion-reduce:transition-none")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: "pan-y" }}
      >
        {children}
      </div>
    </div>
  );
}
