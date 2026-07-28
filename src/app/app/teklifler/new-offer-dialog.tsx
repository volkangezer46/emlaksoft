"use client";

import { useActionState, useState } from "react";
import { Plus, Tag, Loader2 } from "lucide-react";
import { createOffer, type OfferResult } from "@/app/actions/offers";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

const init: OfferResult = {};

const fieldCls =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

type PropertyOption = { id: string; property_code: string; title: string | null; list_price: number | null };
type CustomerOption = { id: string; full_name: string };

export function NewOfferDialog({
  properties,
  customers,
  defaultPropertyId = null,
  defaultCustomerId = null,
  autoOpen = false,
}: {
  properties: PropertyOption[];
  customers: CustomerOption[];
  /** ?portfoy= — eşleştirme ekranındaki "Teklif al" kısayolunun ön dolgusu. */
  defaultPropertyId?: string | null;
  /** ?musteri= — aynı kısayolun müşteri ön dolgusu. */
  defaultCustomerId?: string | null;
  /** Ön dolgu geçerliyse diyalog doğrudan açık gelir (çıkmaz sokak olmasın). */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [state, action, isPending] = useActionState(createOffer, init);

  // Auto-fill amount from selected property
  const preselectedProperty = defaultPropertyId
    ? properties.find((p) => p.id === defaultPropertyId) ?? null
    : null;
  const [selectedPrice, setSelectedPrice] = useState<number | null>(preselectedProperty?.list_price ?? null);

  function handlePropertyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const prop = properties.find((p) => p.id === e.target.value);
    setSelectedPrice(prop?.list_price ?? null);
  }

  // Close on success
  if (state?.ok && open) {
    setOpen(false);
  }

  return (
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA.
       Düz başlık DialogHeader'a geçince gradient başlık + ikon da kazandı. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Yeni teklif
        </button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Tag />}
          title="Yeni teklif oluştur"
          description="Portföye gelen teklifi kaydedin; durum akışı otomatik başlar."
        />
        <form action={action} className="space-y-4 p-6">
              {/* Portföy */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="offer-property">
                  Portföy <span className="text-danger-500">*</span>
                </label>
                <select
                  id="offer-property"
                  name="property_id"
                  required
                  defaultValue={preselectedProperty?.id ?? ""}
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
                  defaultValue={
                    defaultCustomerId && customers.some((c) => c.id === defaultCustomerId)
                      ? defaultCustomerId
                      : ""
                  }
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
                <p className="rounded-[10px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
                  {state.error}
                </p>
              )}

              <div className="hairline-t flex justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button
                    type="button"
                    className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:border-hairline-strong hover:bg-canvas"
                  >
                    İptal
                  </button>
                </DialogClose>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
                  {isPending ? "Kaydediliyor…" : "Teklif oluştur"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
