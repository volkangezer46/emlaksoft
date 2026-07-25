"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createValuation } from "@/app/actions/valuations";
import { useToast } from "@/components/app/toast-provider";
import { GeoSelect } from "@/components/app/geo-select";

type Prop = { id: string; property_code: string; title: string | null; list_price: number | null };
type Province = { id: string; name: string };

const PROPERTY_TYPES = ["Daire", "Villa", "Arsa", "İşyeri", "Müstakil ev", "Bina"];

export function ValuationForm({
  properties,
  provinces,
  defaultPropertyId,
}: {
  properties: Prop[];
  provinces: Province[];
  defaultPropertyId?: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    const res = await createValuation(formData);
    setPending(false);
    if (res.ok) {
      push("Değerleme oluşturuldu", "ok");
      router.refresh();
      return;
    }
    push(res.error ?? "Hata", "err");
  }

  return (
    <form action={onSubmit} className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 className="font-display font-bold text-ink-950">Yeni değerleme</h2>
      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1.5 block text-sm text-text-muted">Portföy</label>
          <select name="property_id" defaultValue={defaultPropertyId ?? ""} className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm">
            <option value="">Seçiniz (opsiyonel)</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.property_code} · {p.title || "Başlıksız"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-text-muted">Başlık</label>
          <input name="title" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="Onikişubat 3+1 değerleme" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">Liste fiyatı</label>
            <input name="list_price" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="6.750.000" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">m²</label>
            <input name="sqm" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="135" />
          </div>
        </div>
        {/* Onceden il ADI + serbest metin "Ilce ipucu" aliniyordu. Serbest metin
            geo_districts ile eslesmedigi icin emsal motoru yalnizca bir portfoy
            secildiginde devreye girebiliyordu. Artik gercek district_id gidiyor. */}
        <GeoSelect provinces={provinces} withNeighborhood={false} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">Portföy türü</label>
            <select name="property_type" defaultValue="" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm">
              <option value="">Fark etmez</option>
              {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">İşlem türü</label>
            <select name="transaction_type" defaultValue="" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm">
              <option value="">Fark etmez</option>
              <option value="Satılık">Satılık</option>
              <option value="Kiralık">Kiralık</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">Ada (opsiyonel)</label>
            <input name="ada" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="1245" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted">Parsel (opsiyonel)</label>
            <input name="parsel" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm" placeholder="7" />
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-text-faint">
          İlçe seçilirse kendi portföy ve satış verinizden gerçek emsal analizi çalışır.
          Endeksa &amp; Tapusor anahtarları tanımlandıysa onlar da kaynak olarak eklenir.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="btn-shine w-full rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Hesaplanıyor…" : "Değerle"}
        </button>
      </div>
    </form>
  );
}
