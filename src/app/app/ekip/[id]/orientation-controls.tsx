"use client";

import { useActionState, useEffect, useRef } from "react";
import { CheckCircle2, Circle, PlayCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/ui/form-controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { removeOrientation, startOrientation, toggleOrientationItem, type RecruitResult } from "@/app/actions/recruiting";

const init: RecruitResult = {};

/** Sabit alanları gönderimde FormData'ya ekler (ham gizli alan yerine; dokunma hedefi sözleşmesi). */
function withFields(action: (fd: FormData) => void, fields: Record<string, string>) {
  return (fd: FormData) => {
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    action(fd);
  };
}

function useToastResult(state: RecruitResult) {
  const { push } = useToast();
  useEffect(() => {
    if (state.ok && state.info) push(state.info, "ok");
    else if (state.error) push(state.error, "err");
  }, [state, push]);
}

/** Oryantasyon adımı onay kutusu (üye ve ekip yöneticisi). Bağlı görev de tamamlanır / yeniden açılır. */
export function OrientationToggle({ id, done, label, disabled }: { id: string; done: boolean; label: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(toggleOrientationItem, init);
  useToastResult(state);
  return (
    <form action={withFields(action, { id: id, done: done ? "" : "1" })}>
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        disabled={disabled || pending}
        aria-pressed={done}
        aria-label={`${label}: ${done ? "tamamlandı, açık olarak işaretle" : "tamamlandı olarak işaretle"}`}
        className="h-11 w-11 shrink-0"
      >
        {done ? <CheckCircle2 className="h-5 w-5 text-mint-600" aria-hidden /> : <Circle className="h-5 w-5" aria-hidden />}
      </Button>
    </form>
  );
}

/** Oryantasyonu başlat: başlangıç günü + adımları görev olarak ata. */
export function StartOrientationForm({ profileId, today, stepCount }: { profileId: string; today: string; stepCount: number }) {
  const [state, action, pending] = useActionState(startOrientation, init);
  useToastResult(state);
  return (
    <form action={withFields(action, { profile_id: profileId })} className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
      <FormField label="İşe başlangıç günü" htmlFor={`orient-start-${profileId}`}>
        <FormInput id={`orient-start-${profileId}`} name="start_on" type="date" defaultValue={today} />
      </FormField>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-ink-950">
        <input type="checkbox" name="as_tasks" defaultChecked className="h-4 w-4 accent-brand-600 touch:h-5 touch:w-5" />
        Adımları danışmana görev olarak ata
      </label>
      <Button type="submit" icon={PlayCircle} loading={pending} className="w-full sm:w-auto">
        Oryantasyonu başlat ({stepCount} adım)
      </Button>
    </form>
  );
}

export function RemoveOrientationButton({ profileId }: { profileId: string }) {
  const [state, action, pending] = useActionState(removeOrientation, init);
  const formRef = useRef<HTMLFormElement>(null);
  useToastResult(state);
  return (
    <form ref={formRef} action={withFields(action, { profile_id: profileId })}>
      <ConfirmDialog
        title="Oryantasyon listesi kaldırılsın mı?"
        description="Adımlar silinir, bağlı açık görevler iptal edilir (tamamlanan görevler kalır)."
        confirmLabel="Kaldır"
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={
          <Button type="button" size="sm" variant="ghost" icon={Trash2} loading={pending}>
            Listeyi kaldır
          </Button>
        }
      />
    </form>
  );
}
