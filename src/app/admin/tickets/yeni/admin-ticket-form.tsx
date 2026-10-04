"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TAB_ICONS as TI } from "@/lib/icons";
import { getTicketCategoriesForTenant } from "@/app/actions/admin-ticket-ops";
import { searchTicketTenants } from "@/app/actions/admin-ticket-extra";
import { createSupportTicketAsStaff } from "@/app/actions/tickets";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { TICKET_LIMITS } from "@/lib/support/ticket-contract";
import { TICKET_PRIORITY_KEYS, TICKET_PRIORITY_LABEL } from "../ticket-list-model";
import { ADMIN_TICKET_TABS } from "./ticket-tabs";

const TAB_ICONS = { talep: TI.destek, aciklama: TI.aciklama } as const;
const FIELD_LABELS = { tenant_id: "Ofis", subject: "Konu", body: "Açıklama" };

type Option = { value: string; label: string };

/** Ofis adına destek talebi: tam sayfa sekmeli form (popup yok). */
export function AdminTicketForm({
  tenantOptions,
  categories,
  defaultTenantId,
}: {
  tenantOptions: ComboboxOption[];
  categories: Option[];
  defaultTenantId?: string;
}) {
  const router = useRouter();
  const [requestId, setRequestId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState(defaultTenantId ?? "");
  const [categoryOptions, setCategoryOptions] = useState<Option[]>(categories);
  const lookup = useRef(0);

  // Güvenli gönderim kimliği (çift tıklamada çift talep oluşmaz); render dışında üretilir.
  useEffect(() => {
    const t = window.setTimeout(() => setRequestId(crypto.randomUUID()), 0);
    return () => window.clearTimeout(t);
  }, []);

  const tabs: FormTab[] = useMemo(
    () =>
      ADMIN_TICKET_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  function onTenantChange(next: string) {
    setTenantId(next);
    if (!next) return;
    const n = ++lookup.current;
    startTransition(async () => {
      const r = await getTicketCategoriesForTenant(next);
      if (n !== lookup.current) return;
      setCategoryOptions(r.options?.length ? r.options : categories);
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    if (!requestId) {
      setError("Güvenli gönderim kimliği hazırlanıyor. Lütfen tekrar deneyin.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    setError(null);
    setPending(true);
    startTransition(async () => {
      const res = await createSupportTicketAsStaff({}, fd);
      setPending(false);
      if (!res.ok || !res.ticketId) {
        setError(res.error ?? "Talep oluşturulamadı.");
        return;
      }
      router.push(`/admin/tickets/${res.ticketId}`);
      router.refresh();
    });
  }

  const tabPanels = {
    talep: (
      <>
        <input type="hidden" name="request_id" value={requestId} />
        <FormField label="Ofis" htmlFor="admin-ticket-tenant" required inject={false} className="sm:col-span-2" hint="Talep ofis adına açılır ve tüm hareketler denetim kaydına işlenir.">
          <Combobox
            id="admin-ticket-tenant"
            name="tenant_id"
            options={tenantOptions}
            value={tenantId}
            onValueChange={onTenantChange}
            onSearch={searchTicketTenants}
            placeholder="Talebin açılacağı ofisi seçin"
            searchPlaceholder="Ofis adı yazın…"
            emptyText="Uygun ofis bulunamadı"
            required
            clearable={false}
          />
        </FormField>
        <FormField label="Konu" htmlFor="subject" required className="sm:col-span-2">
          <FormInput name="subject" required minLength={3} maxLength={TICKET_LIMITS.subjectMax} autoComplete="off" placeholder="Örn. Portal ilanı gönderim hatası" />
        </FormField>
        <FormField label="Kategori" htmlFor="category">
          <FormSelect name="category" defaultValue={categoryOptions.some((o) => o.value === "general") ? "general" : categoryOptions[0]?.value}>
            {categoryOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Öncelik" htmlFor="priority">
          <FormSelect name="priority" defaultValue="normal">
            {[...TICKET_PRIORITY_KEYS].reverse().map((p) => (
              <option key={p} value={p}>{TICKET_PRIORITY_LABEL[p]}</option>
            ))}
          </FormSelect>
        </FormField>
      </>
    ),
    aciklama: (
      <FormField label="Açıklama" htmlFor="body" required className="sm:col-span-2">
        <FormTextarea name="body" required minLength={3} maxLength={TICKET_LIMITS.bodyMax} rows={9} className="resize-y leading-relaxed" placeholder="Sorunu, beklenen sonucu ve bilinen ayrıntıları yazın…" />
      </FormField>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const subject = (values.subject ?? "").trim();
    const body = (values.body ?? "").trim().replace(/\s+/g, " ");
    const tenantLabel = tenantOptions.find((o) => o.value === tenantId)?.label ?? (tenantId ? (display.tenant_id ?? null) : null);
    const category = categoryOptions.find((o) => o.value === (values.category ?? "general"))?.label;
    const priority = TICKET_PRIORITY_LABEL[(values.priority ?? "normal") as keyof typeof TICKET_PRIORITY_LABEL];
    return (
      <SummaryGroup title="Talep özeti">
        <SummaryRow label="Ofis" value={tenantLabel ?? "Zorunlu"} muted={!tenantLabel} tab="talep" field="tenant_id" />
        <SummaryRow label="Konu" value={subject || "Zorunlu"} muted={!subject} tab="talep" field="subject" />
        <SummaryRow label="Kategori" value={category ?? "Genel"} tab="talep" field="category" />
        <SummaryRow label="Öncelik" value={priority ?? "Normal"} tab="talep" field="priority" />
        <SummaryRow label="Açıklama" value={body || "Zorunlu"} muted={!body} tab="aciklama" field="body" />
      </SummaryGroup>
    );
  }

  return (
    <TabbedFormShell
      title="Ofis adına destek talebi"
      description="Talebi doğru ofis, kategori ve öncelikle destek kuyruğuna ekleyin."
      eyebrow="Destek talepleri"
      breadcrumbs={[{ label: "Destek talepleri", href: "/admin/tickets" }, { label: "Yeni talep" }]}
      cancelHref="/admin/tickets"
      submitLabel="Talebi oluştur"
      pendingLabel="Oluşturuluyor…"
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
    />
  );
}
