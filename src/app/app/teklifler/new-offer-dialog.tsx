"use client";

import { useActionState, useState } from "react";
import { Plus, X, Tag, Loader2 } from "lucide-react";
import { createOffer, type OfferResult } from "@/app/actions/offers";

const init: OfferResult = {};

const fieldCls =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

type PropertyOption = { id: string; property_code: string; title: string | null; list_price: number | null };
type CustomerOption = { id: string; full_name: string };

export function NewOfferDialog({
  properties,
  customers,
}: {
  properties: PropertyOption[];
  customers: CustomerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, isPending] = useActionState(createOffer, init);

  // Auto-fill amount from selected property
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);

  function handlePropertyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const prop = properties.find((p) => p.id === e.target.value);
    setSelectedPrice(prop?.list_price ?? null);
  }

  // Close on success
  if (state?.ok && open) {
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        <Plus className="h-4 w-4" /> Yeni teklif
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/60 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-auto w-full max-w-lg rounded-[22px] border border-line bg-surface shadow-[0_40px_90px_-30px_rgba(10,34,71,0.6)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Başlık */}
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-brand-600" />
                <h2 className="font-display font-bold text-ink-950">Yeni teklif oluştur</h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-text-muted hover:text-ink-950"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form */}
            <form action={action} className="p-6 space-y-4">
              {/* Portföy */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="offer-property">
                  Portföy <span className="text-danger-500">*</span>
                </label>
                <select
                  id="offer-property"
                  name="property_id"
                  required
                  onChange={handlePropertyChange}
                  className={`${fieldCls} appearance-none`}
                >
                  <option value="">— Portföy seçin —</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.property_code}{p.title ? ` — ${p.title}` : ""}
                      {p.list_price ? ` (${new Intl.NumberFormat("tr-TR").format(p.list_price)} ₺)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Müşteri */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="offer-customer">
                  Müşteri <span className="text-text-faint text-xs">(opsiyonel)</span>
                </label>
                <select
                  id="offer-customer"
                  name="customer_id"
                  className={`${fieldCls} appearance-none`}
                >
                  <option value="">— Müşteri seçin —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>

              {/* Teklif tutarı */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="offer-amount">
                  Teklif tutarı (₺) <span className="text-danger-500">*</span>
                </label>
                <input
                  id="offer-amount"
                  name="amount"
                  type="number"
                  min="1"
                  step="1000"
                  required
                  defaultValue={selectedPrice ?? ""}
                  key={selectedPrice ?? "no-price"} // reset on property change
                  className={fieldCls}
                  placeholder="ör. 3500000"
                />
                {selectedPrice && (
                  <p className="mt-1 text-[11px] text-text-faint">
                    Liste fiyatı: {new Intl.NumberFormat("tr-TR").format(selectedPrice)} ₺
                  </p>
                )}
              </div>

              {/* Geçerlilik tarihi */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="offer-valid">
                  Geçerlilik tarihi <span className="text-text-faint text-xs">(opsiyonel)</span>
                </label>
                <input
                  id="offer-valid"
                  name="valid_until"
                  type="date"
                  min={new Date().toISOString().slice(0, 10)}
                  className={fieldCls}
                />
              </div>

              {/* Not */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="offer-notes">Not</label>
                <textarea
                  id="offer-notes"
                  name="notes"
                  rows={3}
                  className={`${fieldCls} resize-none`}
                  placeholder="Teklif koşulları, özel notlar…"
                />
              </div>

              {state?.error && (
                <p className="rounded-[10px] bg-danger-500/8 px-3 py-2 text-sm text-danger-500" role="alert">
                  {state.error}
                </p>
              )}

              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:border-line-strong"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                  {isPending ? "Kaydediliyor…" : "Teklif oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
