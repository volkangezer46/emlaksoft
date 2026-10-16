"use client";

import { CustomFieldInputs, type CustomFieldInputDef } from "@/components/app/custom-field-inputs";
import { useMemo, useRef, useState, type FormEvent } from "react";
import Link from "@/components/ui/smart-link";
import { Save, UserRound } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createCustomerWithDemand } from "@/app/actions/customer-with-demand";
import { DemandMatchPreview } from "@/components/app/demand-match-preview";
import { DemandSummaryGroups } from "@/components/app/demand-summary";
import { StructuredDemandFields, useDemandRequired } from "@/components/app/structured-demand-fields";
import { isOwnerSideCustomerType, hasDemandContent } from "@/lib/demand-criteria";
import { GeoSelect } from "@/components/app/geo-select";
import { useCreateForm } from "@/components/app/use-create-form";
import { FormField, FormInput, FormSelect, FormTextarea, fieldClass } from "@/components/ui/form-controls";
import {
  CollapsibleSummaryGroup,
  SubmitConfirmBand,
  SummaryGroup,
  SummaryRow,
  TabbedFormShell,
  type FormTab,
  type TabbedSummaryContext,
} from "@/components/ui/tabbed-form-shell";
import { PhoneInput } from "@/components/ui/phone-input";
import { detailOrList } from "@/lib/form-logic";
import { formatPhoneDisplay, parsePhone } from "@/lib/phone";
import { EmailInput } from "@/components/ui/email-input";
import { DuplicateHint } from "@/components/app/duplicate-hint";
import { CUSTOMER_DRAFT_FIELDS, CUSTOMER_FORM_ID, CUSTOMER_TABS, CUSTOMER_TABS_SIMPLE } from "./customer-tabs";
import { Combobox } from "@/components/ui/combobox";
import { ContactFill } from "./contact-fill";
import { HelperText, useKitSimpleMode } from "@/components/ui/simple-kit";

type Province = { id: string; name: string };
type Branch = { id: string; name: string };

const TAB_ICONS = {
  kisi: TI.kisi,
  iletisim: TI.iletisim,
  talep: TI.talepKriter,
  "ozel-gunler": TI.ozelGunler,
  not: TI.not,
} as const;

const FIELD_LABELS = { full_name: "Ad soyad", phone: "Telefon" };

/** Form başına istek kimliği (sunucu `onceByRequest`); eski tarayıcıda boş (fren atlanır, mükerrer kapısı yine çalışır). */
function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "";
  }
}

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
  initialPhone = "",
  linkRef = "",
  canCreateDemand,
  transactionTypes,
  propertyTypes,
  urgencyOptions,
  customFields = [],
}: {
  /** Ofisin etkin özel alanları (yeni kayıtta girilir; doğrulama/yazım sunucuda). */
  customFields?: CustomFieldInputDef[];
  /** Gelen kutusundan gelen telefon (saklama biçiminde); boşsa alan boş açılır. */
  initialPhone?: string;
  /** Müşteri oluşunca bağlanacak çağrı / iletişim kaydı (`a-<id>` | `c-<id>`). */
  linkRef?: string;
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
    // Kayıttan sonra müşteri kartı "Sonraki adım" sayfasıyla açılır (Şimdi ara / Randevu ver / Ne arıyor?; C11).
    // Talep kaydı düştüyse kart açılmaz: form "Talebe devam et" bandını gösterir.
    redirectTo: (r) => (r.id && !r.demandError ? `/app/musteriler/${r.id}?yeni=1` : detailOrList("/app/musteriler", r.id)),
  });
  // Sade görünüm: tek sayfa, ilk ekranda ad + telefon + tür; diğer bölümler kapalı "Daha fazla bilgi" altında.
  const simple = useKitSimpleMode();
  const req = useDemandRequired();
  // İstek kimliği ilk gönderimde üretilir ve bileşen ömrü boyunca sabit kalır (ret sonrası "Yine de yeni kayıt" aynı kimlikle
  // gider; başarılı kayıttan sonra sayfa değişir, "Kaydet ve yenisini ekle" tam yükler). Render'da üretilmez (SSR uyumu).
  const requestIdRef = useRef<string | null>(null);
  const [customerType, setCustomerType] = useState("Alıcı");
  const ownerSide = isOwnerSideCustomerType(customerType);
  // Müşteri kaydedildi ama talep düştü: yeniden gönderim müşteriyi çoğaltır — kilitle, devam bağlantısı ver.
  const partialCustomerId = state.demandError ? state.id : undefined;

  // Telefonsuz kayıt bilinçli olmalı: ilk gönderimde satır içi onay; "Telefonsuz kaydet" bayrağı koyup yeniden gönderir.
  const [phoneAsk, setPhoneAsk] = useState(false);
  const noPhoneOk = useRef(false);
  function guardedSubmit(e: FormEvent<HTMLFormElement>) {
    const phone = String(new FormData(e.currentTarget).get("phone") ?? "").trim();
    if (!phone && !noPhoneOk.current) {
      e.preventDefault();
      setPhoneAsk(true);
      return;
    }
    // Onay yalnız bu gönderim için geçerli: sunucu hatası/çift kayıt reddi sonrası ya da sonraki kayıtta yeniden sorulur.
    noPhoneOk.current = false;
    setPhoneAsk(false);
    requestIdRef.current ??= newRequestId();
    const idInput = e.currentTarget.elements.namedItem("client_request_id");
    if (idInput instanceof HTMLInputElement) idInput.value = requestIdRef.current;
    onSubmit(e);
  }

  const tabs: FormTab[] = useMemo(
    () =>
      (simple ? CUSTOMER_TABS_SIMPLE : CUSTOMER_TABS).map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
        passive: "passive" in t && t.passive ? [...t.passive] : undefined,
        collapsible: "collapsible" in t ? t.collapsible : undefined,
      })),
    [simple],
  );

  const branchField =
    branches.length > 0 ? (
      <FormField label="Şube" htmlFor="branch_id">
        <Combobox
          name="branch_id"
          defaultValue={""}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          placeholder="Şube atanmadı"
          searchPlaceholder="Şube ara…"
          emptyText="Eşleşen şube yok"
          id="branch_id"
        />
      </FormField>
    ) : null;

  const tabPanels = {
    kisi: (
      <>
        <ContactFill phoneInputId="customer-phone" />
        <FormField label="Ad soyad" htmlFor="full_name" required className="sm:col-span-2">
          <FormInput name="full_name" required placeholder="Örn. Ali Kaya" />
        </FormField>
        <FormField label="Telefon" htmlFor="customer-phone" hint={simple ? undefined : "Yazarken ofisteki aynı numara kontrol edilir."} className="sm:col-span-2">
          <PhoneInput
            id="customer-phone"
            name="phone"
            aria-describedby={simple ? undefined : "customer-phone-hint"}
            className={fieldClass}
            defaultValue={initialPhone || undefined}
          />
          {linkRef ? <input type="hidden" name={"link_ref"} value={linkRef} /> : null}
        </FormField>
        <FormField label="Müşteri türü" htmlFor="type">
          <FormSelect name="type" defaultValue="Alıcı" onChange={(e) => setCustomerType(e.target.value)}>
            {types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </FormSelect>
        </FormField>
        {simple ? null : branchField}
      </>
    ),
    iletisim: (
      <>
        {simple ? branchField : null}
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
        <HelperText className="sm:col-span-2">
          Bütçe, oda, bölge gibi en az bir kriter girerseniz müşteriyle birlikte talep de kaydedilir; hiçbir şey girmezseniz yalnız müşteri kaydedilir.
        </HelperText>
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

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const name = (values.full_name ?? "").trim();
    const branch = branches.find((b) => b.id === values.branch_id)?.name;
    const province = provinces.find((p) => p.id === values.province_id)?.name;
    const phoneRaw = (values.phone ?? "").trim();
    const phone = phoneRaw ? parsePhone(phoneRaw) : null;
    const email = (values.email ?? "").trim();
    const birth = display.birth_date;
    const anniversary = display.anniversary_date;
    const note = (values.notes ?? "").trim().replace(/\s+/g, " ");
    const demandBrief = [values.transaction_type, values.property_type].filter(Boolean).join(" · ");
    return (
      <>
        {ownerSide || !canCreateDemand ? null : <DemandMatchPreview values={values} />}
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
        <CollapsibleSummaryGroup title="Kayıt bilgisi" defaultOpen brief={[name, phone?.ok ? "Telefon var" : null].filter(Boolean).join(" · ")}>
          <SummaryRow label="Ad soyad" value={name || "Zorunlu"} muted={!name} tab="kisi" field="full_name" />
          {branches.length > 0 ? <SummaryRow label="Şube" value={branch ?? "Atanmadı"} muted={!branch} tab="kisi" field="branch_id" /> : null}
          <SummaryRow
            label="Telefon"
            value={!phone ? "Girilmedi" : phone.ok ? formatPhoneDisplay(values.phone ?? "") || String(values.phone) : `${String(values.phone)} · biçim hatalı`}
            muted={!phone}
            tab="kisi"
            field="customer-phone"
          />
          <SummaryRow label="E-posta" value={email ? String(values.email ?? email) : "Girilmedi"} muted={!email} tab="iletisim" field="email" />
          <SummaryRow label="İl" value={province ?? "Seçilmedi"} muted={!province} tab="iletisim" />
          <SummaryRow label="Doğum tarihi" value={birth ?? "Girilmedi"} muted={!birth} tab="ozel-gunler" field="birth_date" />
          <SummaryRow label="Yıldönümü" value={anniversary ?? "Girilmedi"} muted={!anniversary} tab="ozel-gunler" field="anniversary_date" />
          <SummaryRow label="Not" value={note || "Girilmedi"} muted={!note} tab="not" field="notes" />
        </CollapsibleSummaryGroup>
        {ownerSide || !canCreateDemand ? null : (
          <CollapsibleSummaryGroup title="Talep özeti" brief={hasDemandContent(values) ? demandBrief || "Talep açılır" : "Yalnız müşteri kaydedilir"}>
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
              display={display}
              tabs={{ ne: "talep", kriter: "talep", bolge: "talep" }}
              showPreview={false}
            />
          </CollapsibleSummaryGroup>
        )}
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni müşteri"
      description={simple ? undefined : "Temel bilgilerle müşteri kaydı açın."}
      layout={simple ? "single" : "auto"}
      breadcrumbs={[{ label: "Müşteriler", href: "/app/musteriler" }, { label: "Yeni müşteri" }]}
      cancelHref="/app/musteriler"
      submitLabel="Kaydet"
      pendingLabel="Kaydediliyor…"
      submitIcon={Save}
      pending={pending}
      error={error}
      submitDisabled={Boolean(partialCustomerId)}
      notice={
        <>
          {/* Gerçek idempotency (B091): her form açılışı tek istek kimliği; çift tık/yeniden deneme ikinci kayıt açmaz. */}
          <input type="hidden" name={"client_request_id"} defaultValue="" />
          {/* Çift kayıt uyarısı FORM DÜZEYİNDE (B097d): telefon "Kişi", e-posta "İletişim" sekmesinde olsa da görünür;
              numara tamamlanınca hemen, aksi halde 150 ms gecikmeyle. allow_duplicate girdisi tek kalır. */}
          <DuplicateHint kind="customer" />
          {phoneAsk ? (
            <SubmitConfirmBand
              message="Telefon girilmedi. Müşteri telefonsuz kaydedilsin mi? Telefonsuz kayıtta çift kayıt kontrolü ve arama/WhatsApp kısayolları çalışmaz."
              confirmLabel="Telefonsuz kaydet"
              backLabel="Telefon ekle"
              backTab="kisi"
              backField="customer-phone"
              onConfirm={() => {
                noPhoneOk.current = true;
              }}
              onBack={() => setPhoneAsk(false)}
            />
          ) : null}
          {partialCustomerId ? (
          <div role="status" className="rounded-[var(--radius-control)] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Müşteri kaydedildi, talep kaydedilemedi.</p>
            <p className="mt-1">Müşteriyi tekrar kaydetmeyin (aynı kişi iki kez kaydedilmiş olur). Talebi müşteri üzerinden yeniden girin.</p>
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
          ) : null}
        </>
      }
      onSubmit={guardedSubmit}
      tabs={tabs}
      tabPanels={
        simple
          ? { ...tabPanels, iletisim: <>{tabPanels.iletisim}<CustomFieldInputs defs={customFields} /></> }
          : { ...tabPanels, kisi: <>{tabPanels.kisi}<CustomFieldInputs defs={customFields} /></> }
      }
      summary={renderSummary}
      saveAndNew
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: CUSTOMER_FORM_ID, fields: [...CUSTOMER_DRAFT_FIELDS] }}
    />
  );
}
