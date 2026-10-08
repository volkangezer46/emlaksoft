"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveDealProcessStep, type DealProcessResult } from "@/app/actions/deal-process";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField, Input, Textarea } from "@/components/ui/input";
import { FormSelect } from "@/components/ui/form-controls";

/** Tek adımın düzenleme formu (tarih, sorumlu, not, yapıldı). Kaydedince sayfa sunucuda yenilenir. */
export function DealProcessStepForm({
  dealId,
  stepKey,
  plannedLocal,
  assignedTo,
  note,
  done,
  members,
}: {
  dealId: string;
  stepKey: string;
  plannedLocal: string;
  assignedTo: string;
  note: string;
  done: boolean;
  members: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<DealProcessResult, FormData>(saveDealProcessStep, {});
  const id = `dp-${stepKey}`;
  return (
    <form action={action} className="mt-3 grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="deal_id" value={dealId} />
      <input type="hidden" name="step_key" value={stepKey} />
      <FormField label="Planlanan tarih" htmlFor={`${id}-tarih`}>
        <Input id={`${id}-tarih`} name="planned_at" type="datetime-local" defaultValue={plannedLocal} />
      </FormField>
      <FormField label="Sorumlu" htmlFor={`${id}-sorumlu`}>
        <FormSelect id={`${id}-sorumlu`} name="assigned_to" defaultValue={assignedTo}>
          <option value="">Seçilmedi</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Not (yalnız ofis içi)" htmlFor={`${id}-not`} className="sm:col-span-2" error={state.error}>
        <Textarea id={`${id}-not`} name="note" rows={2} maxLength={500} defaultValue={note} placeholder="Örn. banka ekspertiz tarihi, evrak eksiği" />
      </FormField>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink-950 sm:col-span-2">
        <Checkbox name="done" defaultChecked={done} /> Bu adım tamamlandı
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" icon={Save} loading={pending} variant="secondary">
          Kaydet
        </Button>
        {state.ok ? <p className="text-xs font-semibold text-mint-700">Kaydedildi.</p> : null}
      </div>
    </form>
  );
}
