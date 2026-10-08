"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Home, MapPin, Pencil, Ruler, Sparkles } from "lucide-react";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { updateProperty } from "@/app/actions/properties";
import { generatePropertyContent } from "@/app/actions/ai-content";
import { PROPERTY_DESCRIPTION_MAX } from "@/lib/property-description";
import { useToast } from "@/components/app/toast-provider";
import { LatLngPicker } from "@/components/app/lat-lng-picker";
import { GeoSelect } from "@/components/app/geo-select";
import { HEATING_OPTIONS, FACADE_OPTIONS } from "@/app/app/portfoyler/yeni/property-options";
import { defaultDefinitionValues, LEGACY_TRANSACTION_TYPE_VALUES } from "@/lib/definition-defaults";

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
      description?: string | null;
      virtual_tour_url?: string | null;
    };
  };
  provinces: Province[];
  transactionTypes?: string[];
  propertyTypes?: string[];
};

const field =
  "mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

const DEFAULT_TRANSACTION_TYPES = [...defaultDefinitionValues("transaction_type"), ...LEGACY_TRANSACTION_TYPE_VALUES];
const DEFAULT_PROPERTY_TYPES = defaultDefinitionValues("property_type");

export function EditPropertyDialog({
  property,
  provinces,
  transactionTypes = DEFAULT_TRANSACTION_TYPES,
  propertyTypes = DEFAULT_PROPERTY_TYPES,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();
  // İlan açıklaması: tek depo features.description; AI üretimi bu alanı doldurur, kayıt formla yapılır.
  const [description, setDescription] = useState(property.features.description ?? "");
  const [aiPending, startAi] = useTransition();

  function generateDescription() {
    startAi(async () => {
      const res = await generatePropertyContent(property.id, "listing");
      if (res.error || !res.text) {
        push(res.error ?? "Açıklama üretilemedi.", "err");
        return;
      }
      setDescription(res.text.slice(0, PROPERTY_DESCRIPTION_MAX));
      push(res.source === "ai" ? "AI açıklamayı hazırladı; kaydetmek için Kaydet'e basın." : "Şablon açıklama hazırlandı; kaydetmek için Kaydet'e basın.", "ok");
    });
  }

  function submit(fd: FormData) {
    fd.set("id", property.id);
    setError(null);
    startTransition(async () => {
      const res = await updateProperty(fd);
      if (res.error) {
        setError(res.error);
        push(res.error, "err");
      } else {
        push("Portföy güncellendi", "ok");
        setOpen(false);
        router.refresh();
      }
    });
  }

  /* Popup yok: sayfa içi sekme alanı. onSubmit kipi: hatada girilen değerler korunur. */
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Portföyü düzenle"
      description={property.title ?? undefined}
      icon={<Pencil />}
      onSubmit={submit}
      pending={pending}
      error={error}
      fieldLabels={{
        title: "Başlık", transaction_type: "İşlem", property_type: "Tür", list_price: "Liste fiyatı",
        min_price: "Min. fiyat", commission_rate: "Komisyon %", rooms: "Oda", sqm: "m²", floor: "Kat",
        heating: "Isınma", building_age: "Bina yaşı", facade: "Cephe", parcel_block: "Tapu ada",
        parcel_lot: "Tapu parsel", address_line: "Adres", description: "İlan açıklaması", virtual_tour_url: "360° tur / video",
      }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <Pencil className="h-4 w-4" /> Düzenle
        </button>
      )}
      tabs={[
        { id: "temel", label: "Temel", icon: Home, fields: ["title", "transaction_type", "property_type", "list_price", "min_price", "commission_rate"] },
        { id: "ozellik", label: "Özellikler", icon: Ruler, fields: ["rooms", "sqm", "floor", "heating", "building_age", "facade"] },
        { id: "konum", label: "Konum ve tapu", icon: MapPin, fields: ["address_line", "parcel_block", "parcel_lot"] },
        { id: "aciklama", label: "Açıklama", icon: FileText, fields: ["description", "virtual_tour_url"] },
      ]}
      panels={{
        temel: (
          <>
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
              <input name="commission_rate" inputMode="decimal" required min="0.01" max="100" step="0.01" defaultValue={property.commission_rate ?? ""} className={field} />
            </label>
          </>
        ),
        ozellik: (
          <>
            <label className="text-xs font-medium text-text-muted">
              Oda
              <input name="rooms" defaultValue={property.features.rooms ?? ""} className={field} />
            </label>
            <label className="text-xs font-medium text-text-muted">
              m²
              <input name="sqm" defaultValue={property.features.sqm ?? ""} className={field} />
            </label>
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
          </>
        ),
        aciklama: (
          <div className="sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="property-description" className="text-xs font-medium text-text-muted">
                İlan açıklaması (vitrinde ve portal metninde görünür)
              </label>
              <button
                type="button"
                onClick={generateDescription}
                disabled={aiPending}
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5 text-cyan-600" /> {aiPending ? "Hazırlanıyor…" : "AI ile yaz"}
              </button>
            </div>
            <textarea
              id="property-description"
              name="description"
              rows={10}
              maxLength={PROPERTY_DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={field}
            />
            <p className="mt-1 text-right text-xs text-text-faint">
              {description.length}/{PROPERTY_DESCRIPTION_MAX}
            </p>
            <label htmlFor="property-virtual-tour" className="mt-3 block text-xs font-medium text-text-muted">
              360° tur / video bağlantısı (vitrinde gömülü görünür)
            </label>
            <input
              id="property-virtual-tour"
              name="virtual_tour_url"
              type="url"
              inputMode="url"
              maxLength={500}
              defaultValue={property.features.virtual_tour_url ?? ""}
              placeholder="https://my.matterport.com/show/?m=… · YouTube · Vimeo · Kuula"
              className={field}
            />
            <p className="mt-1 text-xs text-text-faint">Yalnız https; Matterport, YouTube, Vimeo ve Kuula bağlantıları kabul edilir. Boş bırakırsanız kaldırılır.</p>
          </div>
        ),
        konum: (
          <>
            {/* Düzenleme formunda da ilçe/mahalle: mevcut il/ilçenin alt listeleri kendiliğinden yüklenir. */}
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
            <label className="text-xs font-medium text-text-muted">
              Tapu — Ada
              <input name="parcel_block" defaultValue={property.parcel_block ?? ""} className={field} />
            </label>
            <label className="text-xs font-medium text-text-muted">
              Tapu — Parsel
              <input name="parcel_lot" defaultValue={property.parcel_lot ?? ""} className={field} />
            </label>
            <LatLngPicker defaultLat={property.lat} defaultLng={property.lng} fieldClass={field} />
          </>
        ),
      }}
    />
  );
}
