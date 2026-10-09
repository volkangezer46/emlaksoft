"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createValuation } from "@/app/actions/valuations";
import { useToast } from "@/components/app/toast-provider";
import { GeoSelect } from "@/components/app/geo-select";
import { Combobox } from "@/components/ui/combobox";
import { searchProperties } from "@/app/actions/lookup";
import { defaultDefinitionValues } from "@/lib/definition-defaults";

type Prop = { id: string; property_code: string; title: string | null; list_price: number | null };
type Province = { id: string; name: string };

const DEFAULT_PROPERTY_TYPES = defaultDefinitionValues("property_type");

export function ValuationForm({
  properties,
  provinces,
  defaultPropertyId,
  propertyTypes = DEFAULT_PROPERTY_TYPES,
}: {
  properties: Prop[];
  provinces: Province[];
  defaultPropertyId?: string;
  propertyTypes?: string[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function onSubmit(formData: FormData) {
    setPending(true);
    setMessage("");
    const res = await createValuation(formData);
    setPending(false);
    if (res.ok) {
      setMessage("Değerleme oluşturuldu.");
      push("Değerleme oluşturuldu", "ok");
      router.refresh();
      return;
    }
    const error = res.error ?? "Değerleme oluşturulamadı.";
    setMessage(error);
    push(error, "err");
  }

  return (
    <form action={onSubmit} aria-busy={pending} aria-describedby="valuation-form-status" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="font-display font-bold text-ink-950">Yeni değerleme</h2>
      <div className="mt-4 space-y-3">
        <div>
          <span className="mb-1.5 block text-sm text-text-muted">Portföy</span>
          {/* Liste sayfadan `.limit(100)` ile geliyor; arama sunucuya iniyor
              ki 100. kayıttan eskisi de bulunabilsin. */}
          <Combobox
            name="property_id"
            aria-label="Portföy"
            defaultValue={defaultPropertyId ?? ""}
            placeholder="Seçiniz (opsiyonel)"
            searchPlaceholder="Kod ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchProperties}
            options={properties.map((p) => ({
              value: p.id,
              label: p.title || "Başlıksız",
              hint: p.property_code,
            }))}
          />
        </div>
        <div>
          <label htmlFor="valuation-title" className="mb-1.5 block text-sm text-text-muted">Başlık</label>
          <input id="valuation-title" name="title" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="Kadıköy 3+1 değerleme" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="valuation-list-price" className="mb-1.5 block text-sm text-text-muted">Liste fiyatı</label>
            <input id="valuation-list-price" name="list_price" inputMode="decimal" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="6.750.000" />
          </div>
          <div>
            <label htmlFor="valuation-sqm" className="mb-1.5 block text-sm text-text-muted">m²</label>
            <input id="valuation-sqm" name="sqm" inputMode="decimal" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="135" />
          </div>
        </div>
        {/* Onceden il ADI + serbest metin "Ilce ipucu" aliniyordu. Serbest metin
            geo_districts ile eslesmedigi icin emsal motoru yalnizca bir portfoy
            secildiginde devreye girebiliyordu. Artik gercek district_id gidiyor. */}
        <GeoSelect provinces={provinces} withNeighborhood={false} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="valuation-property-type" className="mb-1.5 block text-sm text-text-muted">Portföy türü</label>
            <select id="valuation-property-type" name="property_type" defaultValue="" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm">
              <option value="">Fark etmez</option>
              {propertyTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="valuation-transaction-type" className="mb-1.5 block text-sm text-text-muted">İşlem türü</label>
            <select id="valuation-transaction-type" name="transaction_type" defaultValue="" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm">
              <option value="">Fark etmez</option>
              <option value="Satılık">Satılık</option>
              <option value="Kiralık">Kiralık</option>
            </select>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-text-faint">
          İlçe seçilirse kendi portföy ve satış verinizden gerçek emsal analizi çalışır.
          Konut ve arsa için EmlakFiyati bölge endeksi (medyan ₺/m²) de kaynak olarak eklenir; veri yoksa atlanır.
        </p>
        <p id="valuation-form-status" role="status" aria-live="polite" className="sr-only">{message}</p>
        <button
          type="submit"
          disabled={pending}
          className="btn-shine w-full rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Hesaplanıyor…" : "Değerle"}
        </button>
      </div>
    </form>
  );
}
