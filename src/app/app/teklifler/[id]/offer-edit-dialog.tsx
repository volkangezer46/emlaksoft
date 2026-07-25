"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { updateOffer, type OfferResult } from "@/app/actions/offers";

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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-text-muted transition hover:bg-canvas"
      >
        <Pencil className="h-4 w-4" /> Teklifi düzenle
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Teklif düzenle"
              tabIndex={-1}
              className="w-full max-w-md rounded-[20px] border border-line bg-surface p-5 shadow-xl outline-none"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display font-bold text-ink-950">Teklifi Düzenle</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-canvas"
                  aria-label="Kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form action={action} className="grid gap-3">
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
                {state.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {pending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
