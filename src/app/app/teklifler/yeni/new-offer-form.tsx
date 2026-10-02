"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";
import { createOffer, type OfferResult } from "@/app/actions/offers";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";

const init: OfferResult = {};

const fieldCls =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";
const labelCls = "mb-1.5 block text-sm font-medium text-ink-950";

type PropertyOption = { id: string; property_code: string; title: string | null; list_price: number | null };
type CustomerOption = { id: string; full_name: string };

export function NewOfferForm({
  properties,
  customers,
  defaultPropertyId = null,
  defaultCustomerId = null,
  todayIso,
}: {
  properties: PropertyOption[];
  customers: CustomerOption[];
  /** ?portfoy= — eşleştirme ekranındaki "Teklif al" kısayolunun ön dolgusu. */
  defaultPropertyId?: string | null;
  /** ?musteri= — aynı kısayolun müşteri ön dolgusu. */
  defaultCustomerId?: string | null;
  /** Geçerlilik tarihi alt sınırı (sunucudan; bileşende saat okunmaz). */
  todayIso: string;
}) {
  const [state, action, isPending] = useActionState(createOffer, init);
  const { push } = useToast();
  const router = useRouter();

  const preselectedProperty = defaultPropertyId
    ? properties.find((p) => p.id === defaultPropertyId) ?? null
    : null;
  const [selectedPrice, setSelectedPrice] = useState<number | null>(preselectedProperty?.list_price ?? null);

  function handlePropertyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const prop = properties.find((p) => p.id === e.target.value);
    setSelectedPrice(prop?.list_price ?? null);
  }

  // Başarıda teklif detayına git
  useEffect(() => {
    if (state?.ok) {
      push("Teklif oluşturuldu", "ok");
      router.push(state.id ? `/app/teklifler/${state.id}` : "/app/teklifler");
      router.refresh();
    }
  }, [state, push, router]);

  return (
    <form action={action}>
      <FormPage
        title="Yeni teklif"
        description="Portföye gelen teklifi kaydedin; durum akışı otomatik başlar."
        breadcrumbs={[{ label: "Teklifler", href: "/app/teklifler" }, { label: "Yeni teklif" }]}
      >
        <FormSection title="Taraflar" description="Teklifin yapıldığı portföy ve (varsa) müşteri.">
          <div>
            <label className={labelCls} htmlFor="offer-property">
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
          <div>
            <label className={labelCls} htmlFor="offer-customer">
              Müşteri <span className="text-text-faint text-xs">(opsiyonel)</span>
            </label>
            <select
              id="offer-customer"
              name="customer_id"
              defaultValue={
                defaultCustomerId && customers.some((c) => c.id === defaultCustomerId) ? defaultCustomerId : ""
              }
              className={`${fieldCls} appearance-none`}
            >
              <option value="">— Müşteri seçin —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </div>
        </FormSection>

        <FormSection title="Teklif koşulları">
          <div>
            <label className={labelCls} htmlFor="offer-amount">
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
              key={selectedPrice ?? "no-price"} // mülk değişince sıfırla
              className={fieldCls}
              placeholder="ör. 3500000"
            />
            {selectedPrice && (
              <p className="mt-1 text-xs text-text-faint">
                Liste fiyatı: {new Intl.NumberFormat("tr-TR").format(selectedPrice)} ₺
              </p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="offer-valid">
              Geçerlilik tarihi <span className="text-text-faint text-xs">(opsiyonel)</span>
            </label>
            <input id="offer-valid" name="valid_until" type="date" min={todayIso} className={fieldCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="offer-notes">Not</label>
            <textarea
              id="offer-notes"
              name="notes"
              rows={3}
              className={`${fieldCls} resize-none`}
              placeholder="Teklif koşulları, özel notlar…"
            />
          </div>
        </FormSection>

        {state?.error && (
          <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
            {state.error}
          </p>
        )}

        <FormActions>
          <ButtonLink href="/app/teklifler" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={isPending} icon={Tag}>
            {isPending ? "Kaydediliyor…" : "Teklif oluştur"}
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
