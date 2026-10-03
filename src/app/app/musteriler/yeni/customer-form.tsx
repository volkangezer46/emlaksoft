"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Save, UserRound } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createCustomerWithDemand } from "@/app/actions/customer-with-demand";
import { DemandSummaryGroups } from "@/components/app/demand-summary";
import { StructuredDemandFields, useDemandRequired } from "@/components/app/structured-demand-fields";
import { isOwnerSideCustomerType, hasDemandContent } from "@/lib/demand-criteria";
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
  kisi: TI.kisi,
  iletisim: TI.iletisim,
  talep: TI.talepKriter,
  "ozel-gunler": TI.ozelGunler,
  not: TI.not,
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
  canCreateDemand,
  transactionTypes,
  propertyTypes,
  urgencyOptions,
}: {
  provinces: Province[];
  branches: Branch[];
  types: string[];
  userId: string;
  /** `demands:create` izni; yoksa talep sekmesi yalnız açıklama gösterir. */
  canCreateDemand: boolean;
  transactionTypes: string[];
  propertyTypes: string[];
  urgencyOptions: { value: string; label: string }[];
}) {
  // Müşteri + talep tek kullanıcı işlemi (Faz 1: ardışık iki insert; atomik RPC Faz 2).
  const { state, onSubmit, pending, error } = useCreateForm((fd) => createCustomerWithDemand({}, fd), {
    successMessage: (r) => (r.demandId ? "Müşteri ve talep kaydedildi" : "Müşteri kaydedildi"),
    redirectTo: (r) => detailOrList("/app/musteriler", r.id),
  });
  const req = useDemandRequired();
  const [customerType, setCustomerType] = useState("Alıcı");
  const ownerSide = isOwnerSideCustomerType(customerType);
  // Müşteri kaydedildi ama talep düştü: yeniden gönderim müşteriyi çoğaltır — kilitle, devam bağlantısı ver.
  const partialCustomerId = state.demandError ? state.id : undefined;

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
          <FormSelect name="type" defaultValue="Alıcı" onChange={(e) => setCustomerType(e.target.value)}>
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
    talep: ownerSide ? (
      <div className="space-y-3 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-4 sm:col-span-2">
        <p className="text-sm font-semibold text-ink-950">{customerType} için talep değil, portföy girilir</p>
        <p className="text-sm text-text-muted">
          Mülk sahibi ve satıcı müşteriler aradığı bir portföy değil, satacağı/kiralayacağı portföyle takip edilir.
          Müşteriyi kaydettikten sonra müşteri sayfasından, ya da şimdi doğrudan portföy ekleyin.
        </p>
        <Link
          href="/app/portfoyler/yeni"
          className="focus-ring inline-flex items-center rounded-[var(--radius-control)] bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
        >
          Portföyü ekle
        </Link>
      </div>
    ) : !canCreateDemand ? (
      <p className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-4 text-sm text-text-muted sm:col-span-2">
        Talep kaydı için yetkiniz yok; müşteri talep olmadan kaydedilir.
      </p>
    ) : (
      <>
        <p className="text-xs text-text-muted sm:col-span-2">
          Bütçe, oda, bölge gibi en az bir kriter girerseniz müşteriyle birlikte talep de kaydedilir; hiçbir şey girmezseniz yalnız müşteri kaydedilir.
        </p>
        {(["ne", "kriter", "bolge"] as const).map((section) => (
          <StructuredDemandFields
            key={section}
            section={section}
            req={req}
            transactionTypes={transactionTypes}
            propertyTypes={propertyTypes}
            urgencyOptions={urgencyOptions}
            provinces={provinces}
          />
        ))}
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
        <FormTextarea name="notes" rows={6} placeholder="Müşteri hakkında serbest not (görüşme özeti, hatırlatma vb.)" />
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
        {ownerSide || !canCreateDemand ? null : (
          <>
            <SummaryGroup title="Talep kaydı">
              <SummaryRow
                label="Kayıt"
                value={hasDemandContent(values) ? "Müşteriyle birlikte talep açılır" : "Yalnız müşteri kaydedilir"}
                muted={!hasDemandContent(values)}
                tab="talep"
              />
            </SummaryGroup>
            <DemandSummaryGroups
              values={values}
              provinces={provinces}
              urgencyOptions={urgencyOptions}
              tabs={{ ne: "talep", kriter: "talep", bolge: "talep" }}
            />
          </>
        )}
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
      submitDisabled={Boolean(partialCustomerId)}
      notice={
        partialCustomerId ? (
          <div role="status" className="rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Müşteri kaydedildi, talep kaydedilemedi.</p>
            <p className="mt-1">Müşteriyi tekrar kaydetmeyin (mükerrer olur). Talebi müşteri üzerinden yeniden girin.</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link
                href={`/app/musteriler/${partialCustomerId}/talep/yeni`}
                className="font-semibold underline underline-offset-2"
              >
                Talebe devam et
              </Link>
              <Link href={`/app/musteriler/${partialCustomerId}`} className="font-semibold underline underline-offset-2">
                Müşteriyi aç
              </Link>
            </div>
          </div>
        ) : undefined
      }
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: CUSTOMER_FORM_ID, fields: [...CUSTOMER_DRAFT_FIELDS] }}
    />
  );
}
