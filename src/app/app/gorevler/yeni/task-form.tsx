"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { createTask, type TaskResult } from "@/app/actions/tasks";
import { searchCustomers } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Button, ButtonLink } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormActions, FormPage, FormSection } from "@/components/ui/form-page";
import { FormField, Input, Textarea } from "@/components/ui/input";

type Member = { id: string; full_name: string | null };
type Customer = { id: string; full_name: string };

const selectClass =
  "surface-sunken w-full rounded-[var(--radius-control)] border border-hairline px-3.5 py-2.5 text-sm text-ink-950 transition focus:border-brand-400 focus:bg-surface focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

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
  const router = useRouter();
  const { push } = useToast();
  // Tekrar yalnız terminli görevde seçilebilir — termin alanını izle.
  const [due, setDue] = useState("");

  const [state, formAction, pending] = useActionState(
    async (_prev: TaskResult, formData: FormData): Promise<TaskResult> => {
      const result = await createTask({}, formData);
      if (result.ok) {
        push("Görev eklendi", "ok");
        router.push("/app/gorevler");
      }
      return result;
    },
    {},
  );

  return (
    <form action={formAction}>
      <FormPage
        title="Yeni görev ekle"
        description="Takip, arama, ziyaret veya evrak görevi planlayın."
        breadcrumbs={[{ label: "Görevler", href: "/app/gorevler" }, { label: "Yeni görev" }]}
      >
        <FormSection title="Görev" description="Ne yapılacak, hangi türde ve ne kadar acil.">
          <FormField label="Başlık" required htmlFor="task-title" className="sm:col-span-2">
            <Input id="task-title" name="title" required placeholder="Örn. Ahmet Bey'i geri ara" />
          </FormField>
          <FormField label="Tür" htmlFor="task-kind">
            <select id="task-kind" name="kind" defaultValue="followup" className={selectClass}>
              {kindOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
          <FormField label="Öncelik" htmlFor="task-priority">
            <select id="task-priority" name="priority" defaultValue="normal" className={selectClass}>
              <option value="low">Düşük</option>
              <option value="normal">Normal</option>
              <option value="high">Yüksek</option>
            </select>
          </FormField>
          <FormField label="Not" htmlFor="task-notes" className="sm:col-span-2">
            <Textarea id="task-notes" name="notes" rows={3} placeholder="Detay, hazırlık, dikkat edilecekler…" />
          </FormField>
        </FormSection>

        <FormSection title="Zamanlama ve atama" description="Son tarih, tekrar ve sorumlu kişi.">
          <FormField label="Son tarih" htmlFor="task-due">
            <Input id="task-due" name="due_at" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </FormField>
          <FormField label="Tekrar" htmlFor="task-recurrence" hint={due ? undefined : "Tekrar için önce son tarih seçin."}>
            <select id="task-recurrence" name="recurrence" defaultValue="" disabled={!due} className={selectClass}>
              {recurrenceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
          <FormField label="Atanan" htmlFor="task-assignee">
            <select id="task-assignee" name="assigned_to" defaultValue="" className={selectClass}>
              <option value="">Bana ata</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </FormField>
          <FormField label="İlgili müşteri">
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

        {state.error ? <p className="text-sm font-medium text-danger-600" role="alert">{state.error}</p> : null}

        <FormActions>
          <ButtonLink href="/app/gorevler" variant="secondary">İptal</ButtonLink>
          <Button type="submit" loading={pending} icon={Check}>
            {pending ? "Ekleniyor…" : "Görevi ekle"}
          </Button>
        </FormActions>
      </FormPage>
    </form>
  );
}
