"use client";

import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createSupportTicket, type TicketResult } from "@/app/actions/tickets";
import { TicketAttachmentInput, uploadTicketFiles } from "../ticket-attachment-input";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { useToast } from "@/components/app/toast-provider";
import { TICKET_DRAFT_FIELDS, TICKET_FORM_ID, TICKET_TABS } from "./ticket-tabs";

type CreateState = TicketResult & { warning?: string };
const initial: CreateState = {};

const DEFAULT_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "general", label: "Genel" },
  { value: "billing", label: "Abonelik / fatura" },
  { value: "bug", label: "Hata bildirimi" },
  { value: "feature", label: "Özellik isteği" },
  { value: "compliance", label: "İYS / KVKK" },
  { value: "onboarding", label: "Kurulum" },
];

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "low", label: "Düşük" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Yüksek" },
  { value: "urgent", label: "Acil" },
];

const TAB_ICONS = { talep: TI.destek, aciklama: TI.aciklama } as const;
const FIELD_LABELS = { subject: "Konu", body: "Açıklama" };

export function NewTicketForm({
  categoryOptions = DEFAULT_CATEGORY_OPTIONS,
  userId,
}: {
  categoryOptions?: { value: string; label: string }[];
  userId: string;
}) {
  const [requestId, setRequestId] = useState("");
  const [attachmentKey, setAttachmentKey] = useState(0);
  const router = useRouter();
  const { push } = useToast();
  // Form elemanını kabuk üretir; gönderimde buraya alınır (başarıda reset için).
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setRequestId(crypto.randomUUID()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const [state, action, pending] = useActionState<CreateState, FormData>(async (_previous, formData) => {
    const stableRequestId = String(formData.get("request_id") ?? "");
    if (!stableRequestId) return { error: "Güvenli gönderim kimliği hazırlanıyor. Lütfen tekrar deneyin." };

    const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    const ticketData = new FormData();
    for (const field of ["subject", "body", "category", "priority"] as const) {
      ticketData.set(field, String(formData.get(field) ?? ""));
    }
    ticketData.set("request_id", stableRequestId);

    const result = await createSupportTicket({}, ticketData);
    if (!result.ok) return result;
    if (!result.ticketId) return { error: "Talep oluşturuldu ancak güvenli referansı alınamadı." };

    const uploaded = await uploadTicketFiles({
      ticketId: result.ticketId,
      visibility: "public",
      files,
    });

    startTransition(() => {
      formRef.current?.reset();
      setAttachmentKey((value) => value + 1);
      setRequestId(crypto.randomUUID());
    });

    if (!uploaded.ok) {
      return {
        ...result,
        warning:
          uploaded.uploaded > 0
            ? `Talep oluşturuldu ve ${uploaded.uploaded} dosya eklendi; bazı dosyalar eklenemedi. ${uploaded.error ?? ""}`.trim()
            : `Talep oluşturuldu ancak dosya eklenemedi. ${uploaded.error ?? ""}`.trim(),
      };
    }

    startTransition(() => {
      push("Destek talebi oluşturuldu", "ok");
      router.push(`/app/destek/${result.ticketId}`);
      router.refresh();
    });
    return result;
  }, initial);

  // `<form action>` yerine onSubmit: kabuk formu üretir; aynı action aynı FormData ile çağrılır.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    formRef.current = form;
    const formData = new FormData(form);
    startTransition(() => action(formData));
  }

  const tabs: FormTab[] = useMemo(
    () =>
      TICKET_TABS.map((t) => ({
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
    talep: (
      <>
        <input type="hidden" name="request_id" value={requestId} />
        <FormField label="Konu" htmlFor="subject" required className="sm:col-span-2">
          <FormInput
            name="subject"
            required
            minLength={3}
            maxLength={200}
            placeholder="Örn. Portal ilanım yayına gitmiyor"
          />
        </FormField>
        <FormField label="Kategori" htmlFor="category">
          <FormSelect name="category" defaultValue="general">
            {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Öncelik" htmlFor="priority">
          <FormSelect name="priority" defaultValue="normal">
            {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </FormSelect>
        </FormField>
      </>
    ),
    aciklama: (
      <>
        <FormField label="Açıklama" htmlFor="body" required className="sm:col-span-2">
          <FormTextarea
            name="body"
            required
            minLength={3}
            maxLength={20_000}
            rows={8}
            className="resize-y leading-relaxed"
            placeholder="Ne oldu, ne olmasını bekliyordunuz ve hangi adımları denediniz?"
          />
        </FormField>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-semibold text-ink-950">Ekler</p>
          <p className="mb-2 text-xs text-text-faint">İsteğe bağlı: ekran görüntüsü veya belge ekleyebilirsiniz.</p>
          <TicketAttachmentInput key={attachmentKey} id="new-ticket-files" disabled={pending} />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-text-faint">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-600" aria-hidden /> Dosyalar private depoda içerik ve bütünlük denetiminden geçirilir.
          </p>
        </div>
      </>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const subject = (values.subject ?? "").trim();
    const category = categoryOptions.find((o) => o.value === (values.category ?? "general"))?.label;
    const priority = PRIORITY_OPTIONS.find((o) => o.value === (values.priority ?? "normal"))?.label;
    const body = (values.body ?? "").trim().replace(/\s+/g, " ");
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="text-xs font-semibold text-text-muted">{category ?? "Genel"}</p>
          <p className="truncate text-sm font-semibold text-ink-950">{subject || "Konu girilmedi"}</p>
        </div>
        <SummaryGroup title="Talep özeti">
          <SummaryRow label="Konu" value={subject || "Zorunlu"} muted={!subject} tab="talep" field="subject" />
          <SummaryRow label="Kategori" value={category ?? "Genel"} tab="talep" field="category" />
          <SummaryRow label="Öncelik" value={priority ?? "Normal"} tab="talep" field="priority" />
          <SummaryRow
            label="Açıklama"
            value={body || "Zorunlu"}
            muted={!body}
            tab="aciklama"
            field="body"
          />
        </SummaryGroup>
      </>
    );
  }

  const warning = state.warning ? (
    <div className="rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-800" role="status">
      <p>{state.warning}</p>
      {state.ticketId ? <Link href={`/app/destek/${state.ticketId}`} className="mt-1 inline-block font-semibold underline">Oluşturulan talebe git</Link> : null}
    </div>
  ) : null;

  return (
    <TabbedFormShell
      title="Yeni destek talebi"
      description="Sorunu, beklenen sonucu ve denediğiniz adımları paylaşın."
      eyebrow="Destek merkezi"
      breadcrumbs={[{ label: "Destek", href: "/app/destek" }, { label: "Yeni talep" }]}
      cancelHref="/app/destek"
      submitLabel="Talep oluştur"
      pendingLabel="Gönderiliyor…"
      submitDisabled={!requestId}
      pending={pending}
      error={state.error}
      notice={warning}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: TICKET_FORM_ID, fields: [...TICKET_DRAFT_FIELDS] }}
    />
  );
}
