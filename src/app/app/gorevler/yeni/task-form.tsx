"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Check, ListChecks } from "lucide-react";
import { createTask } from "@/app/actions/tasks";
import { searchCustomers } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { TASK_DRAFT_FIELDS, TASK_FORM_ID, TASK_TABS } from "./task-tabs";

type Member = { id: string; full_name: string | null };
type Customer = { id: string; full_name: string };

const kindOptions = [
  { value: "followup", label: "Takip" },
  { value: "call", label: "Arama" },
  { value: "visit", label: "Ziyaret" },
  { value: "document", label: "Evrak" },
  { value: "other", label: "Diğer" },
];

const priorityOptions = [
  { value: "low", label: "Düşük" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Yüksek" },
];

const recurrenceOptions = [
  { value: "", label: "Yok" },
  { value: "daily", label: "Her gün" },
  { value: "weekly", label: "Her hafta" },
  { value: "biweekly", label: "İki haftada bir" },
  { value: "monthly", label: "Her ay" },
];

const TAB_ICONS = {
  gorev: ListChecks,
  zamanlama: CalendarClock,
} as const;

const FIELD_LABELS = { title: "Başlık" };

/** "YYYY-MM-DDTHH:MM" -> "GG.AA.YYYY SS:DD" (yalnız biçim, saat dilimi dönüşümü yok). */
function dueLabel(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec((value ?? "").trim());
  if (!m) return null;
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? ` ${m[4]}` : ""}`;
}

export function TaskForm({ members, customers, userId }: { members: Member[]; customers: Customer[]; userId: string }) {
  // Tekrar yalnız terminli görevde seçilebilir — termin alanını izle.
  const [due, setDue] = useState("");
  const { onSubmit, pending, error } = useCreateForm((fd) => createTask({}, fd), {
    successMessage: "Görev eklendi",
    redirectTo: () => "/app/gorevler",
  });

  const tabs: FormTab[] = useMemo(
    () =>
      TASK_TABS.map((t) => ({
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
    gorev: (
      <>
        <FormField label="Başlık" htmlFor="task-title" required className="sm:col-span-2">
          <FormInput name="title" required placeholder="Örn. Ahmet Bey'i geri ara" />
        </FormField>
        <FormField label="Tür" htmlFor="task-kind">
          <FormSelect name="kind" defaultValue="followup">
            {kindOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Öncelik" htmlFor="task-priority">
          <FormSelect name="priority" defaultValue="normal">
            {priorityOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Not" htmlFor="task-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Detay, hazırlık, dikkat edilecekler…" />
        </FormField>
      </>
    ),
    zamanlama: (
      <>
        <FormField label="Son tarih" htmlFor="task-due">
          <FormInput name="due_at" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </FormField>
        <FormField label="Tekrar" htmlFor="task-recurrence" hint={due ? undefined : "Tekrar için önce son tarih seçin."}>
          <FormSelect name="recurrence" defaultValue="" disabled={!due}>
            {recurrenceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Atanan" htmlFor="task-assignee">
          <FormSelect name="assigned_to" defaultValue="">
            <option value="">Bana ata</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="İlgili müşteri" htmlFor="task-customer">
          <Combobox
            name="customer_id"
            aria-label="İlgili müşteri"
            placeholder="Seçiniz (opsiyonel)"
            searchPlaceholder="Müşteri ara…"
            emptyText="Eşleşen müşteri yok"
            onSearch={searchCustomers}
            options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
          />
        </FormField>
      </>
    ),
  };

  function renderSummary({ values }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const kind = kindOptions.find((o) => o.value === values.kind)?.label;
    const priority = priorityOptions.find((o) => o.value === values.priority)?.label;
    const dueText = dueLabel(values.due_at);
    // Devre dışı alan FormData'ya girmez: değer yoksa "Yok".
    const recurrence = recurrenceOptions.find((o) => o.value === (values.recurrence ?? ""))?.label ?? "Yok";
    const assigneeId = (values.assigned_to ?? "").trim();
    const assignee = assigneeId ? (members.find((m) => m.id === assigneeId)?.full_name ?? "Seçildi") : "Ben";
    const customerId = (values.customer_id ?? "").trim();
    const customer = customerId ? (customers.find((c) => c.id === customerId)?.full_name ?? "Seçildi") : null;
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="truncate text-sm font-semibold text-ink-950">{title || "Başlık girilmedi"}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {[kind, priority ? `${priority} öncelik` : null].filter(Boolean).join(" · ") || "Tür seçilmedi"}
          </p>
        </div>
        <SummaryGroup title="Görev bilgisi">
          <SummaryRow label="Başlık" value={title || "Zorunlu"} muted={!title} tab="gorev" field="title" />
          <SummaryRow label="Son tarih" value={dueText ?? "Belirlenmedi"} muted={!dueText} tab="zamanlama" field="due_at" />
          <SummaryRow label="Tekrar" value={dueText ? recurrence : "Yok"} muted={!dueText || recurrence === "Yok"} tab="zamanlama" field="recurrence" />
          <SummaryRow label="Atanan" value={assignee} tab="zamanlama" field="assigned_to" />
          <SummaryRow label="Müşteri" value={customer ?? "Bağlı değil"} muted={!customer} tab="zamanlama" field="customer_id" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni görev ekle"
      description="Takip, arama, ziyaret veya evrak görevi planlayın."
      breadcrumbs={[{ label: "Görevler", href: "/app/gorevler" }, { label: "Yeni görev" }]}
      cancelHref="/app/gorevler"
      submitLabel="Görevi ekle"
      pendingLabel="Ekleniyor…"
      submitIcon={Check}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: TASK_FORM_ID, fields: [...TASK_DRAFT_FIELDS] }}
    />
  );
}
