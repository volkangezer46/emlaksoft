"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { updateTask, type TaskResult } from "@/app/actions/tasks";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  priority: string;
  due_at: string | null;
  recurrence: string | null;
};

const KINDS = [
  { value: "followup", label: "Takip" },
  { value: "call", label: "Arama" },
  { value: "visit", label: "Ziyaret" },
  { value: "document", label: "Evrak" },
  { value: "other", label: "Diğer" },
];
const PRIORITIES = [
  { value: "low", label: "Düşük" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Yüksek" },
];
const RECURRENCES = [
  { value: "", label: "Yok" },
  { value: "daily", label: "Her gün" },
  { value: "weekly", label: "Her hafta" },
  { value: "biweekly", label: "İki haftada bir" },
  { value: "monthly", label: "Her ay" },
];

// datetime-local için yerel saate göre biçimlendirme (UTC kaymasını önle)
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function TaskEditDialog({
  task,
  variant = "icon",
}: {
  task: Task;
  /**
   * "icon": eylem çubuğundaki kalem düğmesi (varsayılan).
   * "overlay": kartın tamamını kaplayan görünmez tetikleyici — müşterisiz/
   * portföysüz görevlerde karta tıklamak düzenlemeyi açar.
   */
  variant?: "icon" | "overlay";
}) {
  const [open, setOpen] = useState(false);
  // Tekrar yalnız terminli görevde seçilebilir — termin alanını izle.
  const [due, setDue] = useState(() => toLocalInput(task.due_at));
  // Başarıda kapatma efekt içinde değil, action akışında yapılıyor: efekt
  // gövdesinde senkron setState fazladan bir render turu doğuruyordu.
  const [state, action, pending] = useActionState<TaskResult, FormData>(
    async (prev, formData) => {
      const result = await updateTask(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    {},
  );
  /*
   * Radix Dialog'a taşındı. Elle kurulum Esc'i hallediyordu ama FOCUS TRAP ve
   * SCROLL LOCK yoktu. createPortal + useEffect + dialogRef üçlüsü de artık
   * gereksiz — Radix hepsini kendisi yapıyor.
   */
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "overlay" ? (
          <button
            type="button"
            aria-label={`${task.title} görevini düzenle`}
            className="focus-ring absolute inset-0 cursor-pointer rounded-[16px]"
          />
        ) : (
          <button
            type="button"
            aria-label="Görevi düzenle"
            className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-hairline text-text-muted transition hover:border-brand-300"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </DialogTrigger>

      <DialogContent size="sm">
        <DialogHeader icon={<Pencil />} title="Görevi düzenle" />
        <form action={action} className="grid gap-3 p-6">
                <input type="hidden" name="id" value={task.id} />
                <input
                  name="title"
                  required
                  defaultValue={task.title}
                  placeholder="Görev başlığı"
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    name="kind"
                    defaultValue={task.kind}
                    className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <select
                    name="priority"
                    defaultValue={task.priority}
                    className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="text-xs font-semibold text-text-muted">
                  Son tarih
                  <input
                    name="due_at"
                    type="datetime-local"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                </label>
                <label className="text-xs font-semibold text-text-muted">
                  Tekrar
                  <select
                    name="recurrence"
                    defaultValue={task.recurrence ?? ""}
                    disabled={!due}
                    className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {RECURRENCES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {!due ? <span className="mt-1 block font-normal text-text-faint">Tekrar için önce son tarih seçin.</span> : null}
                </label>
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={task.notes ?? ""}
                  placeholder="Not (opsiyonel)"
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                />
                {/* Palet disi red-600 -> danger-600, role="alert" eklendi */}
                {state.error && (
                  <p className="text-xs font-semibold text-danger-600" role="alert">{state.error}</p>
                )}
                <div className="hairline-t mt-1 flex justify-end gap-2 pt-4">
                  <DialogClose asChild>
                    <button
                      type="button"
                      className="focus-ring press rounded-[10px] border border-hairline px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                    >
                      Vazgeç
                    </button>
                  </DialogClose>
                  <button
                    type="submit"
                    disabled={pending}
                    className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {pending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
