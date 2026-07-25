"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  Plus,
  Sparkles,
} from "lucide-react";
import { createProperty } from "@/app/actions/properties";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LatLngPicker } from "@/components/app/lat-lng-picker";
import { GeoSelect } from "@/components/app/geo-select";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

const DEFAULT_PROPERTY_TYPES = ["Daire", "Villa", "Arsa", "İşyeri", "Müstakil ev", "Bina"];
const DEFAULT_TRANSACTION_TYPES = ["Satılık", "Kiralık"];

export function NewPropertyDialog({
  provinces,
  branches = [],
  propertyTypes = DEFAULT_PROPERTY_TYPES,
  transactionTypes = DEFAULT_TRANSACTION_TYPES,
}: {
  provinces: Province[];
  branches?: Branch[];
  propertyTypes?: string[];
  transactionTypes?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createProperty(formData);
    setPending(false);
    if (result.ok) {
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
      return;
    }
    setError(result.error ?? "Portföy eklenemedi.");
  }

  return (
    /* Radix Dialog: focus trap + Esc (öncesinde yoktu) + scroll lock + ARIA.
       Görünüm birebir korundu — DialogHeader zaten bu tasarımın kendisi. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--elev-2)]"
        >
          <Plus className="h-4 w-4" /> Yeni portföy
        </button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader
          icon={<Building2 />}
          title="Yeni portföy oluştur"
          description="Temel bilgilerle taslak portföy açın."
        />
        <form ref={formRef} action={submit} className="grid gap-4 p-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="property-title">Portföy başlığı *</label>
                <input id="property-title" name="title" required className={fieldClass} placeholder="Örn. Onikişubat Tekerek 4+1" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="transaction-type">İşlem türü *</label>
                <div className="relative">
                  <select id="transaction-type" name="transaction_type" required defaultValue="Satılık" className={`${fieldClass} appearance-none`}>
                    {transactionTypes.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="property-type">Portföy türü *</label>
                <div className="relative">
                  <select id="property-type" name="property_type" required defaultValue="Daire" className={`${fieldClass} appearance-none`}>
                    {propertyTypes.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="list-price">Liste fiyatı *</label>
                <input id="list-price" name="list_price" required inputMode="decimal" className={fieldClass} placeholder="6.750.000" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="commission-rate">Komisyon oranı (%)</label>
                <input id="commission-rate" name="commission_rate" inputMode="decimal" className={fieldClass} placeholder="2" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="rooms">Oda</label>
                <input id="rooms" name="rooms" className={fieldClass} placeholder="4+1" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="sqm">Brüt m²</label>
                <input id="sqm" name="sqm" inputMode="decimal" className={fieldClass} placeholder="185" />
              </div>
              {/* İl/İlçe/Mahalle: önceki hâlde yalnızca il sorulur, `district_id`
                  ve `neighborhood_id` kolonları hep NULL kalırdı. Emsal motoru
                  (find_comparables) ilçe üzerinden çalıştığı için veri bulamıyordu. */}
              <GeoSelect provinces={provinces} className="sm:col-span-2" />
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="address-line">Adres özeti</label>
                <input id="address-line" name="address_line" className={fieldClass} placeholder="Cadde, sokak, kapı no…" />
              </div>
              <LatLngPicker fieldClass={fieldClass} />
              {branches.length > 0 ? (
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="property-branch">Şube</label>
                  <div className="relative">
                    <select id="property-branch" name="branch_id" defaultValue="" className={`${fieldClass} appearance-none`}>
                      <option value="">Şube atanmadı</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <Building2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                  </div>
                </div>
              ) : null}

              <div className="sm:col-span-2 rounded-[12px] border border-brand-300/40 bg-brand-600/5 px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Sparkles className="h-4 w-4" /> Portföy taslak olarak açılır; fiyat sağlığı ve portal akışı sonraki adımda tamamlanır.</p>
              </div>

              {error ? <p className="sm:col-span-2 text-sm font-medium text-danger-600" role="alert">{error}</p> : null}

              <div className="hairline-t sm:col-span-2 flex items-center justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button type="submit" disabled={pending} className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  <Check className="h-4 w-4" /> {pending ? "Oluşturuluyor…" : "Portföyü oluştur"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
