"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { updateOffer, type OfferResult } from "@/app/actions/offers";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

type Offer = {
  id: string;
  amount: number;
  valid_until: string | null;
  notes: string | null;
};

export function OfferEditDialog({ offer }: { offer: Offer }) {
  const [open, setOpen] = useState(false);
  // Başarıda kapatma efekt içinde değil, action akışında yapılıyor: efekt
  // gövdesinde senkron setState fazladan bir render turu doğuruyordu.
  const [state, action, pending] = useActionState<OfferResult, FormData>(
    async (prev, formData) => {
      const result = await updateOffer(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    {},
  );
  const fieldClass =
    "mt-1 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Teklifi düzenle"
      icon={<Pencil />}
      action={action}
      pending={pending}
      error={state.error}
      summary
      hiddenFields={<input type="hidden" name="id" value={offer.id} />}
      fieldLabels={{ amount: "Teklif tutarı (₺)", valid_until: "Geçerlilik", notes: "Not" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-text-muted transition hover:bg-canvas"
        >
          <Pencil className="h-4 w-4" /> Teklifi düzenle
        </button>
      )}
      tabs={[{ id: "teklif", label: "Teklif", fields: ["amount", "valid_until", "notes"] }]}
      panels={{
        teklif: (
          <>
            <label className="text-xs font-semibold text-text-muted">
              Teklif tutarı (₺)
              <input name="amount" type="number" min="0" step="1000" required defaultValue={offer.amount} className={fieldClass} />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Geçerlilik tarihi
              <input name="valid_until" type="date" defaultValue={offer.valid_until?.slice(0, 10) ?? ""} className={fieldClass} />
            </label>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Not
              <textarea name="notes" rows={3} defaultValue={offer.notes ?? ""} placeholder="Not (opsiyonel)" className={fieldClass} />
            </label>
          </>
        ),
      }}
    />
  );
}
