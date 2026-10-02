"use client";

import { useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { createPipelineDeal } from "@/app/actions/deals";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";
import { detailOrList } from "@/lib/form-logic";

type Prop = { id: string; property_code: string; title: string | null; list_price: number | null; transaction_type: string };
type Cust = { id: string; full_name: string };

const STAGES = [
  { value: "new", label: "Yeni", help: "Ön görüşme aşaması; portföy, müşteri ve yetki belgesi şart değil." },
  { value: "qualified", label: "Nitelikli", help: "Müşteri ciddi ve bütçesi uygun; hâlâ yetki belgesi şart değil." },
  { value: "negotiation", label: "Müzakere", help: "Fiyat pazarlığı başladı; portföy, müşteri ve yazılı yetki belgesi zorunlu." },
] as const;

const addLink = "mt-1 inline-block text-xs font-semibold text-brand-600 underline underline-offset-2";

export function NewDealForm({ properties, customers }: { properties: Prop[]; customers: Cust[] }) {
  const [stage, setStage] = useState<string>("new");
  const [hasAuthority, setHasAuthority] = useState(false);
  const { onSubmit, pending, error } = useCreateForm((fd) => createPipelineDeal(fd), {
    successMessage: "Anlaşma satış sürecine eklendi",
    redirectTo: (r) => detailOrList("/app/anlasmalar", r.dealId),
    refresh: true,
  });
  const stageMeta = STAGES.find((s) => s.value === stage) ?? STAGES[0];
  const needsAuthority = stage === "negotiation" && !hasAuthority;

  return (
    <FormShell
      title="Yeni anlaşma"
      description="Portföy ve müşteriyi eşleştirip aşamayı belirleyin."
      breadcrumbs={[{ label: "Anlaşmalar", href: "/app/anlasmalar" }, { label: "Yeni anlaşma" }]}
      cancelHref="/app/anlasmalar"
      submitLabel="Kaydet"
      pending={pending}
      error={error}
      onSubmit={onSubmit}
    >
      <FormSection title="Taraflar" description="Müzakere aşaması için portföy ve müşteri zorunludur.">
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
      </FormSection>

      <FormSection title="Anlaşma detayı">
        <FormField label="Tür" htmlFor="deal-type">
          <FormSelect name="deal_type" defaultValue="sale">
            <option value="sale">Satış</option>
            <option value="rent">Kiralama</option>
          </FormSelect>
        </FormField>
        <FormField label="Aşama" htmlFor="deal-stage" hint={stageMeta.help}>
          <FormSelect name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
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
            <span className="font-bold text-mint-700">Yazılı yetki / EİDS onaylı</span>
            <span className="mt-0.5 block text-text-muted">Müzakere veya kazanılan aşaması için gerekli.</span>
          </span>
        </label>
        {needsAuthority ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-800 sm:col-span-2"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            Müzakere aşamasına geçmek için yazılı yetki belgesi gerekir. Yetki onaylıysa yukarıdaki kutuyu işaretleyin;
            değilse aşamayı &quot;Yeni&quot; veya &quot;Nitelikli&quot; bırakın.
          </p>
        ) : null}
      </FormSection>
    </FormShell>
  );
}
