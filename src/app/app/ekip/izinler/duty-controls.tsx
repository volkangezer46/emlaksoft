"use client";

import { useActionState, useEffect, useState } from "react";
import { CalendarPlus, Copy, Plus, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-controls";
import { PersonSelect } from "@/components/ui/person-select";
import { useToast } from "@/components/app/toast-provider";
import { addDutyShift, copyPreviousDutyWeek, fillDutyWeek, removeDutyShift, type DutyResult } from "@/app/actions/duty";
import { DUTY_SLOTS, DUTY_SLOT_LABELS } from "@/lib/duty/logic";

const init: DutyResult = {};

function useResultToast(state: DutyResult) {
  const { push } = useToast();
  useEffect(() => {
    if (state.error) push(state.error, "err");
    else if (state.ok && state.info) push(state.info, "ok");
  }, [state, push]);
}

/** Gün kartında "Nöbetçi ekle": kişi + dilim; tek dokunuşla açılır, sayfa içi (popup yok). */
export function DutyAddForm({ day, dayLabel, people }: { day: string; dayLabel: string; people: readonly { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addDutyShift, init);
  // Açıldığı andaki sonuç nesnesi: yeni bir BAŞARILI sonuç gelince form kendiliğinden kapanır (efektte setState yok).
  const [openedWith, setOpenedWith] = useState<DutyResult | null>(null);
  const open = openedWith !== null && (openedWith === state || !state.ok);
  const setOpen = (v: boolean) => setOpenedWith(v ? state : null);
  useResultToast(state);

  const submit = (fd: FormData) => {
    fd.set("duty_date", day);
    action(fd);
  };

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" icon={Plus} onClick={() => setOpen(true)} aria-label={`${dayLabel} için nöbetçi ekle`}>
        Nöbetçi ekle
      </Button>
    );
  }
  return (
    <form action={submit} className="space-y-2 rounded-[var(--radius-control)] border border-line bg-canvas p-2">
      <label className="sr-only" htmlFor={`duty-p-${day}`}>
        Nöbetçi
      </label>
      <PersonSelect id={`duty-p-${day}`} name="profile_id" people={people} emptyLabel="Kişi seçin" required />
      <label className="sr-only" htmlFor={`duty-s-${day}`}>
        Dilim
      </label>
      <FormSelect id={`duty-s-${day}`} name="slot" defaultValue="tam">
        {DUTY_SLOTS.map((s) => (
          <option key={s} value={s}>
            {DUTY_SLOT_LABELS[s]}
          </option>
        ))}
      </FormSelect>
      <div className="flex gap-2">
        <Button type="submit" size="sm" icon={CalendarPlus} loading={pending} className="flex-1">
          Ekle
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

export function DutyRemoveButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(removeDutyShift, init);
  useResultToast(state);
  return (
    <form
      action={(fd) => {
        fd.set("id", id);
        action(fd);
      }}
    >
      <Button type="submit" size="icon" variant="ghost" loading={pending} aria-label={`${label} nöbetini kaldır`} icon={X} />
    </form>
  );
}

/** Hafta eylemleri: dengeli dağıt + geçen haftayı kopyala (yalnız boş günlere yazar). */
export function DutyWeekActions({ week }: { week: string }) {
  const [filled, fill, filling] = useActionState(fillDutyWeek, init);
  const [copied, copy, copying] = useActionState(copyPreviousDutyWeek, init);
  useResultToast(filled);
  useResultToast(copied);
  const withWeek = (run: (fd: FormData) => void) => (fd: FormData) => {
    fd.set("hafta", week);
    run(fd);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <form action={withWeek(fill)}>
        <Button type="submit" size="sm" variant="outline" icon={Shuffle} loading={filling}>
          Boş günleri dengeli dağıt
        </Button>
      </form>
      <form action={withWeek(copy)}>
        <Button type="submit" size="sm" variant="outline" icon={Copy} loading={copying}>
          Geçen haftayı kopyala
        </Button>
      </form>
    </div>
  );
}
