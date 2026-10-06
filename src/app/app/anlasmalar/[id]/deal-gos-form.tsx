"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { updateDealGos, type DealGosResult } from "@/app/actions/deal-gos";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/input";

export function DealGosForm({
  dealId,
  canEdit,
  referenceNo,
  titleDeedLocal,
}: {
  dealId: string;
  canEdit: boolean;
  referenceNo: string;
  titleDeedLocal: string;
}) {
  const [state, action, pending] = useActionState<DealGosResult, FormData>(updateDealGos, {});
  return (
    <form action={action} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <input type="hidden" name="deal_id" value={dealId} />
      <FormField label="GÖS referans no" htmlFor="gos-ref" error={state.error}>
        <Input
          id="gos-ref"
          name="gos_reference_no"
          defaultValue={referenceNo}
          maxLength={64}
          placeholder="Bankanın verdiği işlem referansı"
          disabled={!canEdit}
          aria-invalid={state.error ? true : undefined}
        />
      </FormField>
      <FormField label="Tapu randevu tarihi" htmlFor="gos-tapu">
        <Input id="gos-tapu" name="title_deed_appointment_at" type="datetime-local" defaultValue={titleDeedLocal} disabled={!canEdit} />
      </FormField>
      {canEdit ? (
        <Button type="submit" icon={Save} loading={pending} variant="secondary">
          Kaydet
        </Button>
      ) : null}
      {state.ok ? <p className="text-xs font-semibold text-mint-700 sm:col-span-3">Kaydedildi.</p> : null}
    </form>
  );
}
