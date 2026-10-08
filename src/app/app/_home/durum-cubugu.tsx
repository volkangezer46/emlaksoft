"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * TEK "Durum çubuğu": en çok 2 bant (öncelik: düşük kontör, hoş geldin kredisi). Kurulum/profil/örnek veri
 * Başlangıç kartında, duyurular Bildirimler > Duyurular'dadır.
 * Her çocuk kendi Suspense sınırında akar ve boşsa hiçbir şey çizmez; çubuk öğe yokken yükseklik 0'dır.
 * Birden çok öğe varsa yalnız ilki görünür, "+N bildirim daha" düğmesi kalanları açar — asıl içerik
 * ilk ekranda kalır. JS yoksa hepsi alt alta görünür (içerik kaybolmaz).
 */
export function DurumCubugu({ children, className }: { children: ReactNode; className?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const sync = () => {
      const items = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.tagName !== "TEMPLATE");
      setCount(items.length);
      items.forEach((c, i) => {
        c.style.display = !open && i > 0 ? "none" : "";
      });
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, [open]);

  return (
    <div className={cn("pm-status", className)} data-tour="durum">
      <div ref={bodyRef} className="pm-status-body">
        {children}
      </div>
      {count > 1 ? (
        <button type="button" className="pm-status-more focus-ring" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Bildirimleri daralt" : `+${count - 1} bildirim daha`}
        </button>
      ) : null}
    </div>
  );
}
