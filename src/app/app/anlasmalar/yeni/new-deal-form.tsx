"use client";

import { CustomFieldInputs, type CustomFieldInputDef } from "@/components/app/custom-field-inputs";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Save, TriangleAlert } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createPipelineDeal } from "@/app/actions/deals";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import {
  SummaryGroup,
  SummaryRow,
  TabbedFormShell,
  type FormTab,
  type TabbedSummaryContext,
} from "@/components/ui/tabbed-form-shell";
import { detailOrList } from "@/lib/form-logic";
import { parseLooseNumber } from "@/lib/form-tabs";
import { formatTry } from "@/lib/utils";
import { defaultStageLabels, stageLabelMap } from "@/lib/deal-stage-labels";
import { DEAL_DRAFT_FIELDS, DEAL_FORM_ID, DEAL_TABS } from "./deal-tabs";

type Prop = { id: string; property_code: string; title: string | null; list_price: number | null; transaction_type: string };
type Cust = { id: string; full_name: string };

// Görünen aşama adları ofis tanımından (stageNames); anahtarlar sabit.
const STAGES = [
  { value: "new", help: "Ön görüşme aşaması; portföy, müşteri ve yetki belgesi şart değil." },
  { value: "qualified", help: "Müşteri ciddi ve bütçesi uygun; hâlâ yetki belgesi şart değil." },
  { value: "negotiation", help: "Fiyat pazarlığı başladı; portföy, müşteri ve yazılı yetki belgesi zorunlu." },
] as const;

const addLink = "mt-1 inline-block text-xs font-semibold text-brand-600 underline underline-offset-2";

const TAB_ICONS = { taraflar: TI.taraflar, detay: TI.detay } as const;

export function NewDealForm({ properties, customers, userId, stageNames = stageLabelMap(defaultStageLabels()), customFields = [] }: { properties: Prop[]; customers: Cust[]; userId: string; stageNames?: Record<string, string>; customFields?: CustomFieldInputDef[] }) {
  const nameOf = (v: string) => stageNames[v] ?? v;
  const [stage, setStage] = useState<string>("new");
  const [hasAuthority, setHasAuthority] = useState(false);
  const { onSubmit, pending, error } = useCreateForm((fd) => createPipelineDeal(fd), {
    successMessage: "Anlaşma satış sürecine eklendi",
    redirectTo: (r) => detailOrList("/app/anlasmalar", r.dealId),
    refresh: true,
  });
  const stageMeta = STAGES.find((s) => s.value === stage) ?? STAGES[0];
  const needsAuthority = stage === "negotiation" && !hasAuthority;

  const tabs: FormTab[] = useMemo(
    () =>
      DEAL_TABS.map((t) => ({
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
    taraflar: (
      <>
        <FormField label="Portföy" htmlFor="deal-property" inject={false}>
          <Combobox
            id="deal-property"
            name="property_id"
            aria-label="Portföy"
            placeholder="Seçilmedi"
            searchPlaceholder="Kod ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchProperties}
            options={properties.map((p) => ({
              value: p.id,
              label: p.title ?? "Başlıksız",
              hint: p.property_code,
            }))}
          />
          {properties.length === 0 ? (
            <Link href="/app/portfoyler/yeni" className={addLink}>Yeni portföy ekle</Link>
          ) : null}
        </FormField>
        <FormField label="Müşteri" htmlFor="deal-customer" inject={false}>
          <Combobox
            id="deal-customer"
            name="customer_id"
            aria-label="Müşteri"
            placeholder="Seçilmedi"
            searchPlaceholder="Müşteri ara…"
            emptyText="Eşleşen müşteri yok"
            onSearch={searchCustomers}
            options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
          />
          {customers.length === 0 ? (
            <Link href="/app/musteriler/yeni" className={addLink}>Yeni müşteri ekle</Link>
          ) : null}
        </FormField>
      </>
    ),
    detay: (
      <>
        <FormField label="Tür" htmlFor="deal-type">
          <FormSelect name="deal_type" defaultValue="sale">
            <option value="sale">Satış</option>
            <option value="rent">Kiralama</option>
          </FormSelect>
        </FormField>
        <FormField label="Aşama" htmlFor="deal-stage" hint={stageMeta.help}>
          <FormSelect name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>{nameOf(s.value)}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Tutar (₺)" htmlFor="deal-value" className="sm:col-span-2">
          <FormInput name="deal_value" inputMode="decimal" placeholder="örn. 4.500.000" />
        </FormField>
        <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs sm:col-span-2">
          <input
            type="checkbox"
            name="has_authority"
            value="1"
            checked={hasAuthority}
            onChange={(e) => setHasAuthority(e.target.checked)}
            className="mt-0.5 accent-mint-600"
          />
          <span>
            <span className="font-bold text-mint-700">Yazılı yetki belgesi onaylı</span>
            <span className="mt-0.5 block text-text-muted">{nameOf("negotiation")} veya {nameOf("won")} aşaması için gerekli.</span>
          </span>
        </label>
      </>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const prop = properties.find((p) => p.id === values.property_id);
    const hasProp = (values.property_id ?? "") !== "";
    const cust = customers.find((c) => c.id === values.customer_id);
    const hasCust = (values.customer_id ?? "") !== "";
    const value = parseLooseNumber(values.deal_value);
    const list = prop?.list_price ?? null;
    const ratio = value != null && value > 0 && list ? Math.round((value / list) * 1000) / 10 : null;
    const missing =
      stage === "negotiation"
        ? [!hasProp ? "portföy" : null, !hasCust ? "müşteri" : null, !hasAuthority ? "yetki belgesi" : null].filter(Boolean)
        : [];
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="line-clamp-2 text-sm font-semibold text-ink-950">
            {prop ? (prop.title ?? "Başlıksız portföy") : hasProp ? "Aramadan seçilen portföy" : "Portföy seçilmedi"}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-muted">
            {prop ? `${prop.property_code} · ${prop.transaction_type}` : "Taraflar sekmesinden seçin"}
          </p>
          <p className="numeric mt-2 text-lg font-semibold text-ink-950">
            {value != null && value > 0 ? formatTry(value) : "Tutar girilmedi"}
          </p>
        </div>
        <SummaryGroup title="Anlaşma">
          <SummaryRow label="Portföy" value={prop?.property_code ?? display.property_id ?? "Seçilmedi"} muted={!hasProp} tab="taraflar" field="deal-property" />
          <SummaryRow label="Müşteri" value={cust?.full_name ?? display.customer_id ?? "Seçilmedi"} muted={!hasCust} tab="taraflar" field="deal-customer" />
          <SummaryRow label="Tür" value={values.deal_type === "rent" ? "Kiralama" : "Satış"} tab="detay" field="deal_type" />
          <SummaryRow label="Aşama" value={nameOf(stageMeta.value)} tab="detay" field="stage" />
          <SummaryRow label="Liste fiyatı" value={list ? formatTry(list) : "Portföy seçilince"} muted={!list} tab="taraflar" field="deal-property" />
          <SummaryRow
            label="Liste fiyatına oran"
            value={ratio != null ? `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(ratio)}` : "Tutar ve portföy girilince"}
            muted={ratio == null}
            tab="detay"
            field="deal_value"
          />
          <SummaryRow label="Yetki belgesi" value={hasAuthority ? "Onaylı" : "Onaylı değil"} muted={!hasAuthority} tab="detay" field="has_authority" />
        </SummaryGroup>
        {missing.length > 0 ? (
          <p role="status" className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-800">
            {nameOf("negotiation")} aşaması için eksik: {missing.join(", ")}.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni anlaşma"
      description="Portföy ve müşteriyi eşleştirip aşamayı belirleyin."
      breadcrumbs={[{ label: "Anlaşmalar", href: "/app/anlasmalar" }, { label: "Yeni anlaşma" }]}
      cancelHref="/app/anlasmalar"
      submitLabel="Kaydet"
      pendingLabel="Kaydediliyor…"
      submitIcon={Save}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={{ ...tabPanels, detay: <>{tabPanels.detay}<CustomFieldInputs defs={customFields} /></> }}
      summary={renderSummary}
      draft={{ userId, formId: DEAL_FORM_ID, fields: [...DEAL_DRAFT_FIELDS] }}
      notice={
        needsAuthority ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-800"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            {nameOf("negotiation")} aşamasına geçmek için yazılı yetki belgesi gerekir. Yetki onaylıysa Anlaşma detayı sekmesindeki kutuyu
            işaretleyin; değilse aşamayı &quot;{nameOf("new")}&quot; veya &quot;{nameOf("qualified")}&quot; bırakın.
          </p>
        ) : null
      }
    />
  );
}
