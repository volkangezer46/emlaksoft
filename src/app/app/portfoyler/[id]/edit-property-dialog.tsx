"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateProperty } from "@/app/actions/properties";
import { useToast } from "@/components/app/toast-provider";
import { LatLngPicker } from "@/components/app/lat-lng-picker";
import { GeoSelect } from "@/components/app/geo-select";
import { HEATING_OPTIONS, FACADE_OPTIONS } from "@/app/app/portfoyler/new-property-dialog";

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
    district_id: string | null;
    neighborhood_id: string | null;
    parcel_block: string | null;
    parcel_lot: string | null;
    lat: number | null;
    lng: number | null;
    features: {
      rooms?: string | null;
      sqm?: number | null;
      floor?: number | string | null;
      heating?: string | null;
      building_age?: number | string | null;
      facade?: string | null;
    };
  };
  provinces: Province[];
  transactionTypes?: string[];
  propertyTypes?: string[];
};

const field =
  "mt-1.5 w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

const DEFAULT_TRANSACTION_TYPES = ["Satılık", "Kiralık", "sale", "rent"];
const DEFAULT_PROPERTY_TYPES = ["Daire", "Villa", "Arsa", "İşyeri", "Diğer"];

export function EditPropertyDialog({
  property,
  provinces,
  transactionTypes = DEFAULT_TRANSACTION_TYPES,
  propertyTypes = DEFAULT_PROPERTY_TYPES,
}: Props) {
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
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <Pencil className="h-4 w-4" /> Düzenle
        </button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Pencil />}
          title="Portföyü düzenle"
          description={property.title ?? undefined}
        />
        <form onSubmit={onSubmit} className="p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2 text-xs font-medium text-text-muted">
                Başlık
                <input name="title" required defaultValue={property.title ?? ""} className={field} />
              </label>
              <label className="text-xs font-medium text-text-muted">
                İşlem
                <select name="transaction_type" defaultValue={property.transaction_type} className={field}>
                  {transactionTypes.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-text-muted">
                Tür
                <select name="property_type" defaultValue={property.property_type} className={field}>
                  {propertyTypes.map((t) => <option key={t}>{t}</option>)}
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
              {/* Detay bilgiler — features anahtarları portal/broşürle aynı;
                  tapu ada/parsel OCR'ın doldurduğu kolonların manuel karşılığı. */}
              <details className="sm:col-span-2 rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5" open={Boolean(property.features.floor ?? property.features.heating ?? property.features.building_age ?? property.parcel_block)}>
                <summary className="cursor-pointer select-none text-xs font-semibold text-ink-950">
                  Detay bilgiler <span className="font-normal text-text-muted">(kat, ısınma, bina yaşı, tapu…)</span>
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-text-muted">
                    Bulunduğu kat
                    <input name="floor" inputMode="numeric" defaultValue={property.features.floor ?? ""} className={field} />
                  </label>
                  <label className="text-xs font-medium text-text-muted">
                    Isınma
                    <select name="heating" defaultValue={property.features.heating ?? ""} className={field}>
                      <option value="">Seçilmedi</option>
                      {HEATING_OPTIONS.map((h) => <option key={h}>{h}</option>)}
                      {property.features.heating && !HEATING_OPTIONS.includes(property.features.heating)
                        ? <option>{property.features.heating}</option>
                        : null}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-text-muted">
                    Bina yaşı
                    <input name="building_age" inputMode="numeric" defaultValue={property.features.building_age ?? ""} className={field} />
                  </label>
                  <label className="text-xs font-medium text-text-muted">
                    Cephe (ops.)
                    <select name="facade" defaultValue={property.features.facade ?? ""} className={field}>
                      <option value="">Seçilmedi</option>
                      {FACADE_OPTIONS.map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-text-muted">
                    Tapu — Ada
                    <input name="parcel_block" defaultValue={property.parcel_block ?? ""} className={field} />
                  </label>
                  <label className="text-xs font-medium text-text-muted">
                    Tapu — Parsel
                    <input name="parcel_lot" defaultValue={property.parcel_lot ?? ""} className={field} />
                  </label>
                </div>
              </details>
              {/* Duzenleme formunda da ilce/mahalle: kayit acilirken mevcut
                  il/ilcenin alt listeleri kendiliginden yuklenir. */}
              <div className="sm:col-span-2">
                <GeoSelect
                  provinces={provinces}
                  defaultProvinceId={property.province_id}
                  defaultDistrictId={property.district_id}
                  defaultNeighborhoodId={property.neighborhood_id}
                />
              </div>
              <label className="sm:col-span-2 text-xs font-medium text-text-muted">
                Adres
                <input name="address_line" defaultValue={property.address_line ?? ""} className={field} />
              </label>
              <LatLngPicker defaultLat={property.lat} defaultLng={property.lng} fieldClass={field} />
            </div>
            <div className="hairline-t mt-4 flex justify-end gap-2 pt-4">
              <DialogClose asChild>
                <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas">
                  Vazgeç
                </button>
              </DialogClose>
              <button type="submit" disabled={pending} className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Kaydet
              </button>
            </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
