"use client";

import { useActionState, useEffect } from "react";
import { UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { PersonSelect, type PersonOption } from "@/components/ui/person-select";
import { useToast } from "@/components/app/toast-provider";
import { clearApprovalDelegate, setApprovalDelegate, type ApprovalResult } from "@/app/actions/approvals";

const init: ApprovalResult = {};

/**
 * Vekil onaylayıcı formu (OA12): ofis sahibi / genel müdür, izindeyken onayların birikmemesi için bir üyeyi bitiş tarihine
 * kadar vekil atar. Sunucu eylemi tarih (en çok 90 gün) ve üyeliği yeniden doğrular; RLS aynı kuralı uygular.
 */
export function DelegateForm({
  people,
  current,
  today,
  maxDay,
}: {
  people: readonly PersonOption[];
  current: { delegateId: string; untilOn: string; note: string | null } | null;
  today: string;
  maxDay: string;
}) {
  const { push } = useToast();
  const [state, save, saving] = useActionState(setApprovalDelegate, init);
  const [cleared, clear, clearing] = useActionState(clearApprovalDelegate, init);

  useEffect(() => {
    if (state.ok && state.info) push(state.info, "ok");
  }, [state, push]);
  useEffect(() => {
    if (cleared.ok && cleared.info) push(cleared.info, "ok");
  }, [cleared, push]);

  const error = state.error ?? cleared.error ?? null;

  return (
    <div className="space-y-3">
      <form action={save} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-end">
        <FormField label="Vekil" htmlFor="delegate-id" required inject={false}>
          <PersonSelect id="delegate-id" name="delegate_id" people={people} defaultValue={current?.delegateId ?? ""} emptyLabel="Üye seçin" required />
        </FormField>
        <FormField label="Bitiş tarihi (dahil)" htmlFor="delegate-until" required>
          <FormInput id="delegate-until" type="date" name="until_on" min={today} max={maxDay} defaultValue={current?.untilOn ?? ""} required />
        </FormField>
        <FormField label="Not (isteğe bağlı)" htmlFor="delegate-note" className="sm:col-span-2">
          <FormInput id="delegate-note" name="note" maxLength={200} placeholder="Ör. Yıllık izin süresince" defaultValue={current?.note ?? ""} />
        </FormField>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" icon={UserCheck} loading={saving}>
            {current ? "Vekili güncelle" : "Vekil ata"}
          </Button>
          {current ? (
            <Button type="submit" formAction={clear} formNoValidate variant="outline" icon={UserX} loading={clearing}>
              Vekaleti bitir
            </Button>
          ) : null}
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
