"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Sparkles } from "lucide-react";
import { createProperty } from "@/app/actions/properties";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { LatLngPicker } from "@/components/app/lat-lng-picker";
import { GeoSelect } from "@/components/app/geo-select";
import { useToast } from "@/components/app/toast-provider";
import { FACADE_OPTIONS, HEATING_OPTIONS } from "./property-options";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";
const labelClass = "mb-1.5 block text-sm font-medium text-ink-950";

const SECTIONS = [
  { id: "temel", label: "Temel bilgi" },
  { id: "konum", label: "Konum" },
  { id: "fiyat", label: "Fiyat ve komisyon" },
  { id: "ozellikler", label: "Özellikler" },
  { id: "not", label: "Ek bilgi" },
] as const;

function SelectField({
  id,
  name,
  label,
  required,
  defaultValue,
  children,
  className,
}: {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  defaultValue: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={labelClass} htmlFor={id}>{label}{required ? " *" : ""}</label>
      <div className="relative">
        <select id={id} name={name} required={required} defaultValue={defaultValue} className={`${fieldClass} appearance-none`}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
      </div>
    </div>
  );
}

export function PropertyForm({
  provinces,
  branches,
  propertyTypes,
  transactionTypes,
}: {
  provinces: Province[];
  branches: Branch[];
  propertyTypes: string[];
  transactionTypes: string[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createProperty(formData);
    if (result.ok) {
      push("Portföy taslak olarak oluşturuldu", "ok");
      router.push("/app/portfoyler");
      return;
    }
    setPending(false);
    setError(result.error ?? "Portföy eklenemedi.");
  }

  return (
    <form action={submit}>
      <FormPage
        title="Yeni portföy oluştur"
        description="Temel bilgilerle taslak portföy açın."
        breadcrumbs={[{ label: "Portföyler", href: "/app/portfoyler" }, { label: "Yeni" }]}
      >
        <nav aria-label="Form bölümleri" className="flex flex-wrap gap-2">
          {SECTIONS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:bg-canvas hover:text-ink-950"
            >
              <span className="numeric text-brand-600">{i + 1}</span> {s.label}
            </a>
          ))}
        </nav>

        <div id="temel" className="scroll-mt-24">
          <FormSection title="Temel bilgi" description="İlanın başlığı ve türü.">
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="property-title">Portföy başlığı *</label>
              <input id="property-title" name="title" required className={fieldClass} placeholder="Örn. Onikişubat Tekerek 4+1" />
            </div>
            <SelectField id="transaction-type" name="transaction_type" label="İşlem türü" required defaultValue="Satılık">
              {transactionTypes.map((type) => <option key={type}>{type}</option>)}
            </SelectField>
            <SelectField id="property-type" name="property_type" label="Portföy türü" required defaultValue="Daire">
              {propertyTypes.map((type) => <option key={type}>{type}</option>)}
            </SelectField>
            <div>
              <label className={labelClass} htmlFor="rooms">Oda</label>
              <input id="rooms" name="rooms" className={fieldClass} placeholder="4+1" />
            </div>
            <div>
              <label className={labelClass} htmlFor="sqm">Brüt m²</label>
              <input id="sqm" name="sqm" inputMode="decimal" className={fieldClass} placeholder="185" />
            </div>
            {branches.length > 0 ? (
              <SelectField id="property-branch" name="branch_id" label="Şube" defaultValue="" className="sm:col-span-2">
                <option value="">Şube atanmadı</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </SelectField>
            ) : null}
          </FormSection>
        </div>

        <div id="konum" className="scroll-mt-24">
          {/* İl/İlçe/Mahalle: emsal motoru (find_comparables) ilçe üzerinden çalışır. */}
          <FormSection title="Konum" description="İl, ilçe, mahalle ve harita noktası emsal analizini besler.">
            <GeoSelect provinces={provinces} className="sm:col-span-2" />
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="address-line">Adres özeti</label>
              <input id="address-line" name="address_line" className={fieldClass} placeholder="Cadde, sokak, kapı no…" />
            </div>
            <LatLngPicker fieldClass={fieldClass} />
          </FormSection>
        </div>

        <div id="fiyat" className="scroll-mt-24">
          <FormSection title="Fiyat ve komisyon">
            <div>
              <label className={labelClass} htmlFor="list-price">Liste fiyatı *</label>
              <input id="list-price" name="list_price" required inputMode="decimal" className={fieldClass} placeholder="6.750.000" />
            </div>
            <div>
              <label className={labelClass} htmlFor="commission-rate">Komisyon oranı (%)</label>
              <input id="commission-rate" name="commission_rate" inputMode="decimal" required min="0.01" max="100" step="0.01" className={fieldClass} placeholder="3" />
            </div>
          </FormSection>
        </div>

        <div id="ozellikler" className="scroll-mt-24">
          {/* features jsonb'ye portal/broşürle AYNI anahtarlarla yazılır (floor, heating, building_age, facade) + tapu ada/parsel. */}
          <FormSection title="Özellikler" description="Kat, ısınma, bina yaşı ve tapu bilgileri (isteğe bağlı).">
            <div>
              <label className={labelClass} htmlFor="floor">Bulunduğu kat</label>
              <input id="floor" name="floor" inputMode="numeric" className={fieldClass} placeholder="Örn. 3 (bodrum için -1)" />
            </div>
            <SelectField id="heating" name="heating" label="Isınma" defaultValue="">
              <option value="">Seçilmedi</option>
              {HEATING_OPTIONS.map((h) => <option key={h}>{h}</option>)}
            </SelectField>
            <div>
              <label className={labelClass} htmlFor="building-age">Bina yaşı</label>
              <input id="building-age" name="building_age" inputMode="numeric" className={fieldClass} placeholder="Örn. 5" />
            </div>
            <SelectField id="facade" name="facade" label="Cephe (ops.)" defaultValue="">
              <option value="">Seçilmedi</option>
              {FACADE_OPTIONS.map((f) => <option key={f}>{f}</option>)}
            </SelectField>
            <div>
              <label className={labelClass} htmlFor="parcel-block">Tapu — Ada</label>
              <input id="parcel-block" name="parcel_block" className={fieldClass} placeholder="Örn. 1234" />
            </div>
            <div>
              <label className={labelClass} htmlFor="parcel-lot">Tapu — Parsel</label>
              <input id="parcel-lot" name="parcel_lot" className={fieldClass} placeholder="Örn. 56" />
            </div>
          </FormSection>
        </div>

        <div id="not" className="scroll-mt-24 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/5 px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Sparkles className="h-4 w-4" /> Portföy taslak olarak açılır; fotoğraf, açıklama, fiyat sağlığı ve portal akışı sonraki adımda detay sayfasında tamamlanır.
          </p>
        </div>

        {error ? <p className="text-sm font-medium text-danger-600" role="alert">{error}</p> : null}

        <FormActions>
          <ButtonLink href="/app/portfoyler" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending}>
            {pending ? null : <Check className="h-4 w-4" />} Portföyü oluştur
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}

