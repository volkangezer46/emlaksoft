"use client";

import { useState, useTransition } from "react";
import { EyeOff } from "lucide-react";
import { setClosedListing } from "@/app/actions/closed-listing";
import { useToast } from "@/components/app/toast-provider";
import { Switch } from "@/components/ui/switch";
import { CLOSED_LISTING_HINT, CLOSED_LISTING_LABEL } from "@/lib/closed-listing";

/** Kapalı (gizli) portföy anahtarı. Kapatınca vitrin, müşteri portalı ve ilan portallarından çekilir; yalnız ofis içinde kullanılır. */
export function ClosedListingCard({ propertyId, initialClosed, canEdit }: { propertyId: string; initialClosed: boolean; canEdit: boolean }) {
  const [closed, setClosed] = useState(initialClosed);
  const [warn, setWarn] = useState<number>(0);
  const [pending, start] = useTransition();
  const { push } = useToast();

  function toggle(next: boolean) {
    setClosed(next);
    start(async () => {
      const res = await setClosedListing(propertyId, next);
      if (res.error) {
        setClosed(!next);
        push(res.error, "err");
        return;
      }
      setWarn(next ? (res.livePortals ?? 0) : 0);
      push(next ? "Portföy kapalı portföy yapıldı" : "Portföy yeniden açıldı", "ok");
    });
  }

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5" aria-labelledby="kapali-portfoy-baslik">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="kapali-portfoy-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
            <EyeOff className="h-4 w-4 text-brand-600" aria-hidden /> {CLOSED_LISTING_LABEL}
          </h2>
          <p className="mt-1 text-xs text-text-muted">{CLOSED_LISTING_HINT}</p>
        </div>
        <Switch checked={closed} onCheckedChange={toggle} disabled={!canEdit || pending} aria-label={CLOSED_LISTING_LABEL} />
      </div>
      {closed ? <p className="mt-3 rounded-[var(--radius-card)] bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-700">Bu portföy şu an yalnız ofis içinde görünür.</p> : null}
      {warn > 0 ? (
        <p className="mt-2 text-xs font-semibold text-danger-600">
          {warn} canlı portal ilanı var; portallardan ayrıca kaldırmanız gerekir (İlan Kontrol / Portallar).
        </p>
      ) : null}
    </section>
  );
}
