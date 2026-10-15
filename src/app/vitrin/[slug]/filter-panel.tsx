"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";

/**
 * Vitrin filtre paneli. Dar ekranda (<1024 px) "Filtrele (n)" düğmesi arkasında kapalı gelir, açılınca ALT SAYFA (sheet)
 * olur: tam genişlik, ekranın %88'i, içerik kayar, "Sonuçları göster" düğmesi altta yapışık (formun içinde). Escape ve
 * arka plan dokunuşu kapatır, sayfa kaydırması kilitlenir, odak kapat düğmesine gelir. Geniş ekranda panel satır içidir
 * ve hep açıktır. Form sunucuda çizilir (children, GET; JS'siz de çalışır); burada yalnız görünürlük durumu tutulur.
 */
export function VitrinFilterPanel({
  activeCount,
  resultCount,
  children,
}: {
  activeCount: number;
  resultCount?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const mobile = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1023.98px)").matches;
    if (!mobile) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const trigger = triggerRef.current;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <div className="mt-5">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vitrin-filtre-paneli"
        className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] border border-white/20 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15 lg:hidden"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filtrele
        {activeCount > 0 ? (
          // Koyu hero (.theme-dark) içinde --ink-950 beyaza döner: mint üstünde beyaz rakam ~2.4:1 kalıyordu.
          // Değişmez lacivert (--navy-900) ile ~7:1.
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-mint-500 px-1.5 text-xs font-extrabold text-[color:var(--navy-900)]">
            {activeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <button
          type="button"
          aria-label="Filtreleri kapat"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      ) : null}
      <div
        id="vitrin-filtre-paneli"
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? "Filtreler" : undefined}
        className={
          open
            ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:max-h-[88dvh] max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:rounded-t-[var(--radius-hero)] max-lg:border-t max-lg:border-white/15 max-lg:bg-[#071a38] max-lg:px-4 max-lg:pt-2 max-lg:shadow-[var(--shadow-lg)] lg:mt-0 lg:block"
            : "hidden lg:mt-0 lg:block"
        }
      >
        {open ? (
          <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center justify-between gap-3 bg-[#071a38] px-4 pb-2 pt-1 lg:hidden">
            <p className="font-display text-base font-extrabold text-white">
              Filtreler
              {resultCount != null ? (
                <span className="ml-2 text-xs font-semibold text-white/50">{resultCount.toLocaleString("tr-TR")} ilan</span>
              ) : null}
            </p>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Filtreleri kapat"
              className="focus-ring grid h-11 w-11 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className={open ? "max-lg:pb-[env(safe-area-inset-bottom)]" : undefined}>{children}</div>
      </div>
    </div>
  );
}
