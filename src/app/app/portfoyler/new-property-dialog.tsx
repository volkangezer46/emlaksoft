"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  MapPin,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { createProperty } from "@/app/actions/properties";
import { LatLngPicker } from "@/components/app/lat-lng-picker";

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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--shadow-sm)]"
      >
        <Plus className="h-4 w-4" /> Yeni portföy
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/55 p-4 backdrop-blur-md sm:items-center">
          <div className="w-full max-w-2xl overflow-hidden rounded-[22px] border border-white/20 bg-surface shadow-[var(--shadow-lg)]">
            <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] px-6 py-5 text-white">
              <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/10 text-mint-400"><Building2 className="h-5 w-5" /></span>
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Yeni portföy oluştur</h2>
                    <p className="text-xs text-white/55">Temel bilgilerle taslak portföy açın.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/8 text-white/70 transition hover:bg-white/15 hover:text-white" aria-label="Kapat">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

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
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="property-province">İl</label>
                <div className="relative">
                  <select id="property-province" name="province_id" defaultValue="" className={`${fieldClass} appearance-none`}>
                    <option value="">Seçiniz</option>
                    {provinces.map((province) => <option key={province.id} value={province.id}>{province.name}</option>)}
                  </select>
                  <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="address-line">Adres özeti</label>
                <input id="address-line" name="address_line" className={fieldClass} placeholder="Mahalle, cadde…" />
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

              {error ? <p className="sm:col-span-2 text-sm text-danger-500" role="alert">{error}</p> : null}

              <div className="sm:col-span-2 flex items-center justify-end gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">Vazgeç</button>
                <button type="submit" disabled={pending} className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  <Check className="h-4 w-4" /> {pending ? "Oluşturuluyor…" : "Portföyü oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
