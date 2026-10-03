"use client";

import { useMemo } from "react";
import { CalendarHeart, MapPin, Save, StickyNote, UserRound } from "lucide-react";
import { createCustomer } from "@/app/actions/customers";
import { GeoSelect } from "@/components/app/geo-select";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect, FormTextarea, fieldClass } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { PhoneInput } from "@/components/ui/phone-input";
import { detailOrList } from "@/lib/form-logic";
import { parsePhone } from "@/lib/phone";
import { EmailInput } from "@/components/ui/email-input";
import { CUSTOMER_DRAFT_FIELDS, CUSTOMER_FORM_ID, CUSTOMER_TABS } from "./customer-tabs";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const TAB_ICONS = {
  kisi: UserRound,
  iletisim: MapPin,
  "ozel-gunler": CalendarHeart,
  not: StickyNote,
} as const;

const FIELD_LABELS = { full_name: "Ad soyad" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toLocaleUpperCase("tr-TR");
}

export function CustomerForm({
  provinces,
  branches,
  types,
  userId,
}: {
  provinces: Province[];
  branches: Branch[];
  types: string[];
  userId: string;
}) {
  const { onSubmit, pending, error } = useCreateForm((fd) => createCustomer({}, fd), {
    successMessage: "Müşteri kaydedildi",
    redirectTo: (r) => detailOrList("/app/musteriler", r.id),
  });

  const tabs: FormTab[] = useMemo(
    () =>
      CUSTOMER_TABS.map((t) => ({
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
    kisi: (
      <>
        <FormField label="Ad soyad" htmlFor="full_name" required className="sm:col-span-2">
          <FormInput name="full_name" required placeholder="Örn. Ali Kaya" />
        </FormField>
        <FormField label="Müşteri türü" htmlFor="type">
          <FormSelect name="type" defaultValue="Alıcı">
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </FormSelect>
        </FormField>
        {branches.length > 0 ? (
          <FormField label="Şube" htmlFor="branch_id">
            <FormSelect name="branch_id" defaultValue="">
              <option value="">Şube atanmadı</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </FormSelect>
          </FormField>
        ) : null}
      </>
    ),
    iletisim: (
      <>
        <FormField label="Telefon" htmlFor="phone">
          <PhoneInput name="phone" className={fieldClass} />
        </FormField>
        <FormField label="E-posta" htmlFor="email">
          <EmailInput name="email" />
        </FormField>
        {/* Müşteride mahalle gereksiz; ilçe yeterli. */}
        <div className="sm:col-span-2">
          <GeoSelect provinces={provinces} withNeighborhood={false} />
        </div>
      </>
    ),
    "ozel-gunler": (
      <>
        <FormField label="Doğum tarihi" htmlFor="birth_date">
          <FormInput name="birth_date" type="date" max="2100-12-31" />
        </FormField>
        <FormField label="Yıldönümü" htmlFor="anniversary_date">
          <FormInput name="anniversary_date" type="date" max="2100-12-31" />
        </FormField>
        <FormField label="Yıldönümü notu" htmlFor="anniversary_note" className="sm:col-span-2">
          <FormInput name="anniversary_note" placeholder="Örn. İlk ev alımı, 3 yıllık kiracı" />
        </FormField>
      </>
    ),
    not: (
      <FormField label="Not" htmlFor="notes" className="sm:col-span-2">
        <FormTextarea name="notes" rows={6} placeholder="Talep, bütçe, tercih vb." />
      </FormField>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const name = (values.full_name ?? "").trim();
    const branch = branches.find((b) => b.id === values.branch_id)?.name;
    const province = provinces.find((p) => p.id === values.province_id)?.name;
    const phoneRaw = (values.phone ?? "").trim();
    const phone = phoneRaw ? parsePhone(phoneRaw) : null;
    const email = (values.email ?? "").trim();
    const days = [values.birth_date, values.anniversary_date].filter((v) => (v ?? "").trim() !== "").length;
    return (
      <>
        <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600/10 text-sm font-semibold text-brand-700"
          >
            {initials(name) || <UserRound className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-950">{name || "Ad soyad girilmedi"}</p>
            <p className="truncate text-xs text-text-muted">{values.type || "Tür seçilmedi"}</p>
          </div>
        </div>
        <SummaryGroup title="Kayıt bilgisi">
          <SummaryRow label="Ad soyad" value={name || "Zorunlu"} muted={!name} tab="kisi" field="full_name" />
          {branches.length > 0 ? <SummaryRow label="Şube" value={branch ?? "Atanmadı"} muted={!branch} tab="kisi" field="branch_id" /> : null}
          <SummaryRow
            label="Telefon"
            value={!phone ? "Girilmedi" : phone.ok ? (phone.kind === "mobile" ? "Cep · biçim geçerli" : "Sabit/yurt dışı · biçim geçerli") : "Biçim hatalı"}
            muted={!phone}
            tab="iletisim"
            field="phone"
          />
          <SummaryRow label="E-posta" value={email ? "Girildi" : "Girilmedi"} muted={!email} tab="iletisim" field="email" />
          <SummaryRow label="İl" value={province ?? "Seçilmedi"} muted={!province} tab="iletisim" />
          <SummaryRow
            label="Hatırlatma"
            value={days > 0 ? `${days} özel gün` : "Yok"}
            muted={days === 0}
            tab="ozel-gunler"
            field="birth_date"
          />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni müşteri"
      description="Temel bilgilerle müşteri kaydı açın."
      breadcrumbs={[{ label: "Müşteriler", href: "/app/musteriler" }, { label: "Yeni müşteri" }]}
      cancelHref="/app/musteriler"
      submitLabel="Kaydet"
      pendingLabel="Kaydediliyor…"
      submitIcon={Save}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: CUSTOMER_FORM_ID, fields: [...CUSTOMER_DRAFT_FIELDS] }}
    />
  );
}
