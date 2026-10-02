"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPipelineDeal } from "@/app/actions/deals";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Combobox } from "@/components/ui/combobox";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";

type Prop = { id: string; property_code: string; title: string | null; list_price: number | null; transaction_type: string };
type Cust = { id: string; full_name: string };

const controlCls =
  "mt-1.5 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";

export function NewDealForm({ properties, customers }: { properties: Prop[]; customers: Cust[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createPipelineDeal(fd);
      if (res.error) {
        setError(res.error);
        push(res.error, "err");
        return;
      }
      push("Anlaşma pipeline’a eklendi", "ok");
      router.push(res.dealId ? `/app/anlasmalar/${res.dealId}` : "/app/anlasmalar");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <FormPage
        title="Yeni anlaşma"
        description="Portföy ve müşteriyi eşleştirip aşamayı belirleyin."
        breadcrumbs={[{ label: "Anlaşmalar", href: "/app/anlasmalar" }, { label: "Yeni anlaşma" }]}
      >
        <FormSection title="Taraflar" description="Müzakere aşaması için portföy ve müşteri zorunludur.">
          <div className="block text-xs font-medium text-text-muted">
            Portföy
            <Combobox
              className="mt-1.5"
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
          </div>
          <div className="block text-xs font-medium text-text-muted">
            Müşteri
            <Combobox
              className="mt-1.5"
              name="customer_id"
              aria-label="Müşteri"
              placeholder="Seçilmedi"
              searchPlaceholder="Müşteri ara…"
              emptyText="Eşleşen müşteri yok"
              onSearch={searchCustomers}
              options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
            />
          </div>
        </FormSection>

        <FormSection title="Anlaşma detayı">
          <label className="block text-xs font-medium text-text-muted">
            Tür
            <select name="deal_type" defaultValue="sale" className={controlCls}>
              <option value="sale">Satış</option>
              <option value="rent">Kiralama</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-text-muted">
            Aşama
            <select name="stage" defaultValue="new" className={controlCls}>
              <option value="new">Yeni</option>
              <option value="qualified">Nitelikli</option>
              <option value="negotiation">Müzakere</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-text-muted sm:col-span-2">
            Tutar (₺)
            <input name="deal_value" inputMode="decimal" placeholder="örn. 4.500.000" className={controlCls} />
          </label>
          <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-mint-500/25 bg-mint-500/5 px-3 py-2.5 text-xs sm:col-span-2">
            <input type="checkbox" name="has_authority" value="1" className="mt-0.5 accent-mint-600" />
            <span>
              <span className="font-bold text-mint-700">Yazılı yetki / EİDS onaylı</span>
              <span className="mt-0.5 block text-text-muted">Müzakere veya kazanılan aşaması için gerekli.</span>
            </span>
          </label>
        </FormSection>

        {error ? (
          <p className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
            {error}
          </p>
        ) : null}

        <FormActions>
          <ButtonLink href="/app/anlasmalar" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending}>Kaydet</Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
