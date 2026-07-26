"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { addOfferRound, type OfferResult } from "@/app/actions/offers";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Pazarlık turu ekleme diyaloğu — taraf + tutar + not; round_no server'da son+1. */
export function OfferRoundDialog({ offerId }: { offerId: string }) {
  const [open, setOpen] = useState(false);
  // Başarıda kapatma action akışında — OfferEditDialog ile aynı desen.
  const [state, action, pending] = useActionState<OfferResult, FormData>(
    async (prev, formData) => {
      const result = await addOfferRound(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    {},
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-hairline px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-canvas"
        >
          <Plus className="h-3.5 w-3.5" /> Tur ekle
        </button>
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader icon={<Plus />} title="Pazarlık turu ekle" />
        <form action={action} className="grid gap-3 p-6">
          <input type="hidden" name="offer_id" value={offerId} />
          <label className="text-xs font-semibold text-text-muted">
            Taraf
            <select
              name="side"
              required
              defaultValue="buyer"
              className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
            >
              <option value="buyer">Alıcı</option>
              <option value="seller">Satıcı</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-text-muted">
            Tutar (₺)
            <input
              name="amount"
              type="number"
              min="0"
              step="1000"
              required
              placeholder="Tur tutarı"
              className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
          </label>
          <textarea
            name="note"
            rows={3}
            placeholder="Not (opsiyonel)"
            className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
          />
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
