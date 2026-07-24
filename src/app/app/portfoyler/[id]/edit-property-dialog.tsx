"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { updateProperty } from "@/app/actions/properties";
import { useToast } from "@/components/app/toast-provider";
import { LatLngPicker } from "@/components/app/lat-lng-picker";

type Province = { id: string; name: string };

type Props = {
  property: {
    id: string;
    title: string | null;
    transaction_type: string;
    property_type: string;
    list_price: number | null;
    min_price: number | null;
    commission_rate: number | null;
    address_line: string | null;
    province_id: string | null;
    lat: number | null;
    lng: number | null;
    features: { rooms?: string | null; sqm?: number | null };
  };
  provinces: Province[];
};

const field =
  "mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

export function EditPropertyDialog({ property, provinces }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("id", property.id);
    startTransition(async () => {
      const res = await updateProperty(fd);
      if (res.error) push(res.error, "err");
      else {
        push("Portföy güncellendi", "ok");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white"
      >
        <Pencil className="h-4 w-4" /> Düzenle
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <button type="button" aria-label="Kapat" className="absolute inset-0 bg-ink-950/55 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <form
            onSubmit={onSubmit}
            className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-lg)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink-950">Portföyü düzenle</h2>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-faint hover:bg-canvas" aria-label="Kapat">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2 text-xs font-medium text-text-muted">
                Başlık
                <input name="title" required defaultValue={property.title ?? ""} className={field} />
              </label>
              <label className="text-xs font-medium text-text-muted">
                İşlem
                <select name="transaction_type" defaultValue={property.transaction_type} className={field}>
                  <option>Satılık</option>
                  <option>Kiralık</option>
                  <option value="sale">sale</option>
                  <option value="rent">rent</option>
                </select>
              </label>
              <label className="text-xs font-medium text-text-muted">
                Tür
                <select name="property_type" defaultValue={property.property_type} className={field}>
                  <option>Daire</option>
                  <option>Villa</option>
                  <option>Arsa</option>
                  <option>İşyeri</option>
                  <option>Diğer</option>
                </select>
              </label>
              <label className="text-xs font-medium text-text-muted">
                Liste fiyatı
                <input name="list_price" required defaultValue={property.list_price ?? ""} className={field} />
              </label>
              <label className="text-xs font-medium text-text-muted">
                Min. fiyat
                <input name="min_price" defaultValue={property.min_price ?? ""} className={field} />
              </label>
              <label className="text-xs font-medium text-text-muted">
                Komisyon %
                <input name="commission_rate" defaultValue={property.commission_rate ?? ""} className={field} />
              </label>
              <label className="text-xs font-medium text-text-muted">
                Oda
                <input name="rooms" defaultValue={property.features.rooms ?? ""} className={field} />
              </label>
              <label className="text-xs font-medium text-text-muted">
                m²
                <input name="sqm" defaultValue={property.features.sqm ?? ""} className={field} />
              </label>
              <label className="sm:col-span-2 text-xs font-medium text-text-muted">
                İl
                <select name="province_id" defaultValue={property.province_id ?? ""} className={field}>
                  <option value="">Seçilmedi</option>
                  {provinces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2 text-xs font-medium text-text-muted">
                Adres
                <input name="address_line" defaultValue={property.address_line ?? ""} className={field} />
              </label>
              <LatLngPicker defaultLat={property.lat} defaultLng={property.lng} fieldClass={field} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-text-muted">
                Vazgeç
              </button>
              <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Kaydet
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
