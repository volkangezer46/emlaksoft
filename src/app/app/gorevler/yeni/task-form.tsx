"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { createTask } from "@/app/actions/tasks";
import { searchCustomers } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { FormSection, FormShell } from "@/components/ui/form-page";

type Member = { id: string; full_name: string | null };
type Customer = { id: string; full_name: string };

const kindOptions = [
  { value: "followup", label: "Takip" },
  { value: "call", label: "Arama" },
  { value: "visit", label: "Ziyaret" },
  { value: "document", label: "Evrak" },
  { value: "other", label: "Diğer" },
];

const recurrenceOptions = [
  { value: "", label: "Yok" },
  { value: "daily", label: "Her gün" },
  { value: "weekly", label: "Her hafta" },
  { value: "biweekly", label: "İki haftada bir" },
  { value: "monthly", label: "Her ay" },
];

export function TaskForm({ members, customers }: { members: Member[]; customers: Customer[] }) {
  // Tekrar yalnız terminli görevde seçilebilir — termin alanını izle.
  const [due, setDue] = useState("");
  const { onSubmit, pending, error } = useCreateForm((fd) => createTask({}, fd), {
    successMessage: "Görev eklendi",
    redirectTo: () => "/app/gorevler",
  });

  return (
    <FormShell
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
    >
      <FormSection title="Görev" description="Ne yapılacak, hangi türde ve ne kadar acil.">
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
            <option value="low">Düşük</option>
            <option value="normal">Normal</option>
            <option value="high">Yüksek</option>
          </FormSelect>
        </FormField>
        <FormField label="Not" htmlFor="task-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Detay, hazırlık, dikkat edilecekler…" />
        </FormField>
      </FormSection>

      <FormSection title="Zamanlama ve atama" description="Son tarih, tekrar ve sorumlu kişi.">
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
      </FormSection>
    </FormShell>
  );
}
