"use client";

import { useEffect, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearTourDone, TOUR_RESTART_HREF } from "@/lib/product-tour-storage";

const AUTO_KEY = "emlaksoft:wizard-tour-autostarted";
const COUNTDOWN_SEC = 6;

function alreadyAutoStarted(): boolean {
  try {
    return window.localStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return true; // depolama yoksa otomatik yönlendirme yapma (tekrar tekrar tetiklenebilir)
  }
}

function startTour() {
  try {
    window.localStorage.setItem(AUTO_KEY, "1");
  } catch {
    /* yazılamazsa yine de başlat */
  }
  clearTourDone();
  window.location.assign(TOUR_RESTART_HREF);
}

/**
 * Kurulum bitince kutlamanın altında: rolün tanıtım turu birkaç saniye sonra kendiliğinden başlar
 * (yalnız ilk kez; "Şimdi değil" ile durdurulur). Sayaç temizlenir; ekran okuyucuya sakin duyurulur.
 */
export function FinishTourStarter() {
  const [left, setLeft] = useState<number | null>(null);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (alreadyAutoStarted()) return;
    const arm = window.setTimeout(() => setLeft(COUNTDOWN_SEC), 0);
    return () => window.clearTimeout(arm);
  }, []);

  useEffect(() => {
    if (left === null || stopped) return;
    if (left <= 0) {
      startTour();
      return;
    }
    const id = window.setTimeout(() => setLeft((n) => (n === null ? n : n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [left, stopped]);

  const counting = left !== null && !stopped;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
      <MapIcon className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-text-muted" role="status" aria-live="polite">
        {counting ? `Kısa tanıtım turu ${left} saniye içinde başlıyor.` : "Sistemi kısa bir turla tanıyın; her adım ilgili sayfada öğeyi gösterir."}
      </p>
      <Button type="button" variant="secondary" onClick={startTour}>
        Turu şimdi başlat
      </Button>
      {counting ? (
        <Button type="button" variant="ghost" onClick={() => setStopped(true)}>
          Şimdi değil
        </Button>
      ) : null}
    </div>
  );
}
