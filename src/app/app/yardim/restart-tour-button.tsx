"use client";

import { Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOURS } from "@/lib/product-tour-data";
import { clearTourDone, tourHref, TOUR_RESTART_HREF } from "@/lib/product-tour-storage";

/** Rolünüzün turunu baştan başlatır: "görüldü" işaretlerini siler ve ana ekranı ?tur=1 ile açar. */
export function RestartTourButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  return (
    <Button
      variant={variant}
      icon={MapIcon}
      onClick={() => {
        clearTourDone();
        window.location.assign(TOUR_RESTART_HREF);
      }}
    >
      Turları yeniden başlat
    </Button>
  );
}

/** Yardım sayfasında tüm kısa turların listesi; her biri 4-6 adım, yetkinize ve açık modüllere göre kısalır. */
export function TourPicker() {
  return (
    <section aria-labelledby="turlar" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <h2 id="turlar" className="font-display text-lg font-bold text-ink-950">
        Tanıtım turları
      </h2>
      <p className="mt-1 text-sm text-text-muted">Kısa turlar ilgili sayfada öğeleri tek tek gösterir. Klavyede sağ/sol ok ve Esc çalışır.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {TOURS.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
            <span className="text-sm font-semibold text-ink-950">{t.label}</span>
            <span className="text-xs text-text-muted">{t.description}</span>
            <Button
              variant="secondary"
              icon={MapIcon}
              className="mt-auto self-start"
              onClick={() => {
                clearTourDone();
                window.location.assign(tourHref(t.id));
              }}
            >
              Başlat
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
