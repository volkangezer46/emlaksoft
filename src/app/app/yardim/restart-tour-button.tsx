"use client";

import { Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOURS } from "@/lib/product-tour-data";
import { clearTourDone, tourHref } from "@/lib/product-tour-storage";

type TourCard = { id: string; label: string; description: string };

function StartTourButton({ id, variant = "secondary" }: { id: string; variant?: "primary" | "secondary" }) {
  return (
    <Button
      variant={variant}
      icon={MapIcon}
      className="self-start"
      onClick={() => {
        clearTourDone();
        window.location.assign(tourHref(id));
      }}
    >
      Turu başlat
    </Button>
  );
}

/**
 * Yardım sayfasında tanıtım turu (C29): YALNIZ kullanıcının rol turu kart olarak görünür (ilk sıradaki = rolün turu;
 * en çok 5 adım). Başka rollerin turları "Diğer turlar" altında katlıdır. Ad ve açıklama adminden düzenlenmiş olabilir
 * (sunucu `tours` verir); verilmezse koddaki varsayılanlar.
 */
export function TourPicker({ tours = TOURS }: { tours?: readonly TourCard[] }) {
  const [own, ...others] = tours;
  if (!own) return null;
  return (
    <section aria-labelledby="tur" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div data-tour-card={own.id} className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="tur" className="font-display text-lg font-bold text-ink-950">
            {own.label}
          </h2>
          <p className="mt-1 text-base text-text-muted">{own.description} Bir dakika sürer.</p>
        </div>
        <StartTourButton id={own.id} variant="primary" />
      </div>
      {others.length > 0 ? (
        <details className="mt-3 border-t border-line pt-2">
          <summary className="focus-ring inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-600">Diğer turlar</summary>
          <ul className="mt-2 space-y-2">
            {others.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-950">{t.label}</span>
                  <span className="block text-sm text-text-muted">{t.description}</span>
                </span>
                <StartTourButton id={t.id} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
