"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, ListPlus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import {
  createCoachingSession,
  deleteCoachingSession,
  toggleCoachingCommitment,
  type CoachingResult,
} from "@/app/actions/coaching";

const init: CoachingResult = {};

type Row = { key: number; body: string; due: string; task: boolean };

/**
 * Yeni birebir görüşme formu (OA8): not + taahhüt satırları (her biri isteğe bağlı terminli, "görev olsun" ile danışmana
 * görev açılır) + sonraki görüşme. O anki karne özeti `snapshot` gizli alanıyla gider; sunucu yalnız bilinen sayıları alır.
 */
export function CoachingSessionForm({ profileId, snapshot, today }: { profileId: string; snapshot: string; today: string }) {
  const { push } = useToast();
  const [state, action, pending] = useActionState(createCoachingSession, init);
  const [rows, setRows] = useState<Row[]>([{ key: 0, body: "", due: "", task: true }]);
  const nextKey = useRef(1);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      push(state.info ?? "Görüşme kaydedildi.", "ok");
      formRef.current?.reset();
      setRows([{ key: nextKey.current++, body: "", due: "", task: true }]);
    } else if (state.error) push(state.error, "err");
  }, [state, push]);

  // Gizli alanlar FormData'ya gönderimde eklenir (ham gizli <input> yok; satır sırası korunur).
  const submit = (fd: FormData) => {
    fd.set("profile_id", profileId);
    fd.set("snapshot", snapshot);
    fd.delete("commitment_task");
    for (const r of rows) fd.append("commitment_task", r.task ? "1" : "");
    action(fd);
  };
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form ref={formRef} action={submit} className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5">
      <div>
        <h3 className="font-display text-base font-bold text-ink-950">Yeni birebir görüşme</h3>
        <p className="text-xs text-text-muted">Bu ayın karnesi görüşmeye otomatik eklenir. Not yalnız danışman, siz ve ofis yönetimi tarafından görülür.</p>
      </div>
      <FormField label="Görüşme notu" htmlFor={`coach-notes-${profileId}`}>
        <FormTextarea id={`coach-notes-${profileId}`} name="notes" rows={4} maxLength={5000} placeholder="Neler konuşuldu, nerede takılıyor, neyi deneyeceksiniz?" />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-ink-950">Taahhütler</legend>
        {rows.map((r, i) => (
          <div key={r.key} className="grid gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto] sm:items-center">
            <label className="sr-only" htmlFor={`coach-c-${r.key}`}>
              Taahhüt {i + 1}
            </label>
            <FormInput id={`coach-c-${r.key}`} name="commitment" value={r.body} onChange={(e) => update(r.key, { body: e.target.value })} maxLength={300} placeholder="Ör. Bu hafta 5 yer gösterme" />
            <label className="sr-only" htmlFor={`coach-d-${r.key}`}>
              Termin
            </label>
            <FormInput id={`coach-d-${r.key}`} type="date" name="commitment_due" min={today} value={r.due} onChange={(e) => update(r.key, { due: e.target.value })} />
            <label className="inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-text-muted">
              <input className="h-4 w-4 touch:h-5 touch:w-5" type="checkbox" checked={r.task} onChange={(e) => update(r.key, { task: e.target.checked })} />
              Görev olsun
            </label>
            {rows.length > 1 ? (
              <Button type="button" size="icon" variant="ghost" icon={X} aria-label={`Taahhüt ${i + 1} satırını kaldır`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
            ) : (
              <span className="hidden sm:block" />
            )}
          </div>
        ))}
        {rows.length < 10 ? (
          <Button type="button" size="sm" variant="ghost" icon={ListPlus} onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, body: "", due: "", task: true }])}>
            Taahhüt ekle
          </Button>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-[12rem_1fr] sm:items-end">
        <FormField label="Sonraki görüşme" htmlFor={`coach-next-${profileId}`}>
          <FormInput id={`coach-next-${profileId}`} type="date" name="next_at" min={today} />
        </FormField>
        <div className="flex sm:justify-end">
          <Button type="submit" icon={Save} loading={pending} className="w-full sm:w-auto">
            Görüşmeyi kaydet
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Taahhüt onay kutusu: danışman ve görüşmeyi yapan yönetici işaretler (iyimser değil; sunucu yanıtıyla tazelenir). */
export function CommitmentToggle({ id, done, label, disabled }: { id: string; done: boolean; label: string; disabled?: boolean }) {
  const { push } = useToast();
  const [state, action, pending] = useActionState(toggleCoachingCommitment, init);
  useEffect(() => {
    if (state.error) push(state.error, "err");
  }, [state, push]);
  return (
    <form
      action={(fd) => {
        fd.set("id", id);
        fd.set("done", done ? "" : "1");
        action(fd);
      }}
    >
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

export function DeleteSessionButton({ id }: { id: string }) {
  const { push } = useToast();
  const [state, action, pending] = useActionState(deleteCoachingSession, init);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.error) push(state.error, "err");
    else if (state.ok && state.info) push(state.info, "ok");
  }, [state, push]);
  return (
    <form
      ref={formRef}
      action={(fd) => {
        fd.set("id", id);
        action(fd);
      }}
    >
      <ConfirmDialog
        title="Görüşme silinsin mi?"
        description="Görüşme notu ve taahhütler silinir. Taahhütten açılan görevler görevler listesinde kalır."
        confirmLabel="Sil"
        onConfirm={() => formRef.current?.requestSubmit()}
        trigger={<Button type="button" size="sm" variant="ghost" icon={Trash2} loading={pending}>Sil</Button>}
      />
    </form>
  );
}
