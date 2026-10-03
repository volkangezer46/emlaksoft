"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { useCreateForm } from "@/components/app/use-create-form";
import { searchProperties } from "@/app/actions/lookup";
import { createOpenHouse } from "@/app/actions/targets-openhouse-sources";
import { detailOrList } from "@/lib/form-logic";
import { OPEN_HOUSE_DRAFT_FIELDS, OPEN_HOUSE_FORM_ID, OPEN_HOUSE_TABS } from "./open-house-tabs";

const TAB_ICONS = {
  zaman: TI.zaman,
  yer: TI.konum,
  not: TI.not,
} as const;

const FIELD_LABELS = { property_id: "Portföy", scheduled_at: "Tarih ve saat" };

/** "YYYY-MM-DDTHH:MM" -> "GG.AA.YYYY SS:DD" (yalnız biçim, saat dilimi dönüşümü yok). */
function whenLabel(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec((value ?? "").trim());
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}` : ""}`;
}

export function OpenHouseForm({ userId }: { userId: string }) {
  const [propertyId, setPropertyId] = useState("");
  const { onSubmit, pending, error } = useCreateForm((fd) => createOpenHouse({}, fd), {
    successMessage: "Açık ev günü oluşturuldu",
    redirectTo: (r) => detailOrList("/app/acik-ev", r.id),
  });

  const tabs: FormTab[] = useMemo(
    () =>
      OPEN_HOUSE_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  const tabPanels = {
    zaman: (
      <>
        <FormField label="Portföy" htmlFor="oh-property" required className="sm:col-span-2">
          <Combobox
            name="property_id"
            required
            aria-label="Portföy"
            value={propertyId}
            onValueChange={setPropertyId}
            options={[] as ComboboxOption[]}
            onSearch={searchProperties}
            placeholder="Portföy ara ve seçin"
            searchPlaceholder="Başlık, kod ya da adres…"
            emptyText="Eşleşen portföy yok"
          />
        </FormField>
        <FormField label="Tarih ve saat" htmlFor="oh-scheduled" required>
          <FormInput name="scheduled_at" type="datetime-local" required />
        </FormField>
        <FormField label="Süre (dk)" htmlFor="oh-duration">
          <FormInput name="duration_min" type="number" min={15} step={15} defaultValue={120} />
        </FormField>
      </>
    ),
    yer: (
      <>
        <FormField label="Konum / buluşma noktası" htmlFor="oh-location" className="sm:col-span-2">
          <FormInput name="location" placeholder="Örn. site satış ofisi önü" />
        </FormField>
        <FormField label="Maks. ziyaretçi" htmlFor="oh-max" hint="Boş bırakılırsa sınırsız.">
          <FormInput name="max_visitors" type="number" min={1} placeholder="Sınırsız" />
        </FormField>
      </>
    ),
    not: (
      <FormField label="Not" htmlFor="oh-notes" className="sm:col-span-2">
        <FormTextarea name="notes" rows={5} placeholder="Hazırlık listesi, broşür, ikram…" />
      </FormField>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const hasProperty = (values.property_id ?? "").trim() !== "";
    const when = whenLabel(values.scheduled_at);
    const duration = (values.duration_min ?? "").trim();
    const location = (values.location ?? "").trim();
    const max = (values.max_visitors ?? "").trim();
    const notes = (values.notes ?? "").trim();
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="text-xs text-text-muted">Açık ev günü</p>
          <p className="numeric mt-0.5 text-sm font-semibold text-ink-950">{when ?? "Tarih ve saat girilmedi"}</p>
          <p className="mt-0.5 text-xs text-text-muted">{duration ? `${duration} dk` : "Süre belirtilmedi"}</p>
        </div>
        <SummaryGroup title="Etkinlik bilgisi">
          <SummaryRow label="Portföy" value={hasProperty ? "Seçildi" : "Zorunlu"} muted={!hasProperty} tab="zaman" field="property_id" />
          <SummaryRow label="Tarih ve saat" value={when ?? "Zorunlu"} muted={!when} tab="zaman" field="scheduled_at" />
          <SummaryRow label="Konum" value={location || "Girilmedi"} muted={!location} tab="yer" field="location" />
          <SummaryRow label="Kapasite" value={max ? `${max} ziyaretçi` : "Sınırsız"} muted={!max} tab="yer" field="max_visitors" />
          <SummaryRow label="Not" value={notes ? "Girildi" : "Yok"} muted={!notes} tab="not" field="notes" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni açık ev günü"
      description="Portföy seçin, tarih ve kapasiteyi belirleyin — ziyaretçileri kapıda ekrandan kaydedersiniz."
      breadcrumbs={[{ label: "Açık Ev", href: "/app/acik-ev" }, { label: "Yeni" }]}
      cancelHref="/app/acik-ev"
      submitLabel="Açık ev oluştur"
      submitIcon={Plus}
      submitDisabled={!propertyId}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: OPEN_HOUSE_FORM_ID, fields: [...OPEN_HOUSE_DRAFT_FIELDS] }}
    />
  );
}
