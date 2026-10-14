"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@/components/ui/combobox";
import { searchProperties } from "@/app/actions/lookup";
import { searchCustomers } from "@/app/actions/lookup";
import {
  Check,
  Link2,
  Plus,
  RadioTower,
  Siren,
} from "lucide-react";
import {
  closePortalListing,
  createPortalListing,
} from "@/app/actions/portal-listings";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { LISTING_CHANNEL_OPTIONS } from "@/lib/portals/catalog";

type PropertyOption = { id: string; property_code: string; title: string | null };

const inputClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

export const NEW_PORTAL_PANEL_ID = "portal-ilani-ekle";

/** "Portal ilanı ekle" düğmesi; sayfa içi paneli açar. Portföy yoksa pasiftir. */
export function NewPortalTrigger({
  disabled,
  variant = "hero",
}: {
  disabled?: boolean;
  variant?: "hero" | "solid";
}) {
  return (
    <InlinePanelTrigger
      panelId={NEW_PORTAL_PANEL_ID}
      disabled={disabled}
      className={
        variant === "hero"
          ? "btn-shine bg-white px-4 py-2.5 font-bold text-ink-950 hover:bg-white/90"
          : undefined
      }
    >
      <Plus className="h-4 w-4" /> {variant === "hero" ? "Portal ilanı ekle" : "Yeni portal ilanı"}
    </InlinePanelTrigger>
  );
}

export function NewPortalPanel({ properties }: { properties: PropertyOption[] }) {
  return (
    <InlinePanel
      id={NEW_PORTAL_PANEL_ID}
      title="Portal ilanı bağla"
      description="Portföyü yayın ağına ekleyin."
      icon={<RadioTower />}
    >
      {(close) => <NewPortalForm properties={properties} onDone={close} />}
    </InlinePanel>
  );
}

function NewPortalForm({
  properties,
  onDone,
}: {
  properties: PropertyOption[];
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createPortalListing(formData);
    setPending(false);
    if (result.ok) {
      formRef.current?.reset();
      router.refresh();
      onDone();
    } else {
      setError(result.error ?? "Portal ilanı eklenemedi.");
    }
  }

  return (
    <form ref={formRef} action={submit} className="grid gap-4 p-4 md:p-6">
      <div className="text-sm font-medium text-ink-950">
        Portföy *
        {/* Zorunlu alan: temizleme düğmesi kapalı (`required`),
            boş bırakılırsa gizli input `required` ile submit'i durdurur. */}
        <Combobox
          className="mt-1.5"
          name="property_id"
          required
          aria-label="Portföy"
          placeholder="Portföy seçin"
          searchPlaceholder="Kod ya da başlık ara…"
          emptyText="Eşleşen portföy yok"
          onSearch={searchProperties}
          options={properties.map((property) => ({
            value: property.id,
            label: property.title ?? "İsimsiz portföy",
            hint: property.property_code,
          }))}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-ink-950">
          Portal *
          <select name="portal_name" required defaultValue={LISTING_CHANNEL_OPTIONS[0].value} className={`${inputClass} mt-1.5`}>
            {LISTING_CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink-950">
          İlan numarası
          <input name="portal_listing_id" className={`${inputClass} mt-1.5`} placeholder="128874" />
        </label>
      </div>
      <label className="text-sm font-medium text-ink-950">
        İlan bağlantısı
        <div className="relative mt-1.5">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input name="portal_url" type="url" className={`${inputClass} pl-10`} placeholder="https://…" />
        </div>
      </label>
      {error ? <p role="alert" className="text-sm text-danger-500">{error}</p> : null}
      <div className="hairline-t flex justify-end gap-2 pt-4">
        <button type="button" onClick={onDone} className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
          Vazgeç
        </button>
        <button type="submit" disabled={pending} className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          <Check className="h-4 w-4" /> {pending ? "Kaydediliyor…" : "Yayın ağına ekle"}
        </button>
      </div>
    </form>
  );
}

export function ClosePortalDialog({
  listingId,
  label,
  open: openProp,
  onOpenChange,
}: {
  listingId: string;
  label: string;
  /** Denetimli kullanım (⋮ menüsünden açılış): verilirse kendi "Kapat" düğmesi çizilmez. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await closePortalListing(formData);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(result.error ?? "Kapanış kaydedilemedi.");
    }
  }

  /* Popup yok: sayfa içi sekme alanı (InlineTabbedPanel). */
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="İlan kapanış formu"
      description={label}
      icon={<Siren />}
      onSubmit={submit}
      pending={pending}
      error={error}
      submitLabel="Kapanışı kaydet"
      fieldLabels={{
        reason: "Kapanış nedeni",
        deal_amount: "İşlem bedeli",
        customer_id: "Müşteri",
        deal_happened: "İşlem gerçekleşti",
        closed_by_us: "Biz kapattık",
        competitor_closed: "Rakip kapattı",
        has_authority: "Yazılı yetki belgesi",
      }}
      trigger={openProp !== undefined ? undefined : ({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="rounded-[var(--radius-control)] border border-danger-500/20 px-3 py-2 text-xs font-semibold text-danger-500 transition hover:bg-danger-500/8"
        >
          Kapat
        </button>
      )}
      hiddenFields={<input type="hidden" name="portal_listing_id" value={listingId} />}
      tabs={[
        { id: "kapanis", label: "Kapanış", icon: Siren, fields: ["reason", "deal_amount", "customer_id"] },
        { id: "onay", label: "Onay", icon: Check, fields: ["deal_happened", "closed_by_us", "competitor_closed", "has_authority"] },
      ]}
      panels={{
        kapanis: (
          <>
            <label className="sm:col-span-2 text-sm font-medium text-ink-950">
              Kapanış nedeni *
              <select name="reason" required defaultValue="" className={`${inputClass} mt-1.5`}>
                <option value="" disabled>Neden seçin</option>
                {["Kendi satışımız", "Rakip kapattı", "Mülk sahibi vazgeçti", "Yetki süresi doldu", "Fiyat/şart değişti", "Bilinmiyor"].map((reason) => <option key={reason}>{reason}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-ink-950">
              İşlem bedeli
              <input name="deal_amount" inputMode="decimal" className={`${inputClass} mt-1.5`} placeholder="6.750.000" />
            </label>
            <div className="text-sm font-medium text-ink-950">
              İşlem yapılan müşteri
              <Combobox
                className="mt-1.5"
                name="customer_id"
                aria-label="İşlem yapılan müşteri"
                placeholder="Yalnız bizim kapanışımızda zorunlu"
                searchPlaceholder="Ad veya telefon ile ara…"
                emptyText="Aramak için en az 2 karakter yazın"
                onSearch={searchCustomers}
                options={[]}
              />
            </div>
          </>
        ),
        onay: (
          <>
            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
              {[
                ["deal_happened", "İşlem gerçekleşti"],
                ["closed_by_us", "Biz kapattık"],
                ["competitor_closed", "Rakip kapattı"],
              ].map(([name, text]) => (
                <label key={name} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-xs font-medium text-text-muted">
                  <input type="checkbox" name={name} className="accent-brand-600" /> {text}
                </label>
              ))}
            </div>
            <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs font-medium text-text-muted sm:col-span-2">
              <input type="checkbox" name="has_authority" className="mt-0.5 accent-mint-600" />
              <span><strong className="text-mint-700">Yazılı yetki belgesi onaylı</strong><br />Bizim kapanışımızda müşteri seçimiyle birlikte zorunludur.</span>
            </label>
            <div className="rounded-[var(--radius-control)] border border-danger-500/20 bg-danger-500/5 px-4 py-3 text-xs text-danger-500 sm:col-span-2">Bu kayıt kayıp-kaçak analizine dahil edilir ve sonradan denetlenebilir.</div>
          </>
        ),
      }}
    />
  );
}
