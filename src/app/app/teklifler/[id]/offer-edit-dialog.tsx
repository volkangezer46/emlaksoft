"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { updateOffer, type OfferResult } from "@/app/actions/offers";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

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
  /*
   * Radix Dialog'a taşındı. Elle kurulum Esc'i hallediyordu ama FOCUS TRAP ve
   * SCROLL LOCK yoktu. createPortal + useEffect + dialogRef üçlüsü de artık
   * gereksiz — Radix hepsini kendisi yapıyor.
   */
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-text-muted transition hover:bg-canvas"
        >
          <Pencil className="h-4 w-4" /> Teklifi düzenle
        </button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader icon={<Pencil />} title="Teklifi düzenle" />
        <form action={action} className="grid gap-3 p-6">
                <input type="hidden" name="id" value={offer.id} />
                <label className="text-xs font-semibold text-text-muted">
                  Teklif tutarı (₺)
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="1000"
                    required
                    defaultValue={offer.amount}
                    className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                </label>
                <label className="text-xs font-semibold text-text-muted">
                  Geçerlilik tarihi
                  <input
                    name="valid_until"
                    type="date"
                    defaultValue={offer.valid_until?.slice(0, 10) ?? ""}
                    className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                </label>
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={offer.notes ?? ""}
                  placeholder="Not (opsiyonel)"
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                />
          {/* Palet dışı red-600 → danger-600, role="alert" eklendi */}
          {state.error && (
            <p className="text-xs font-semibold text-danger-600" role="alert">{state.error}</p>
          )}
          <div className="hairline-t mt-1 flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <button
                type="button"
                className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
              >
                Vazgeç
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
