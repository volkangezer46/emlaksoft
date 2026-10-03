"use client";

import { useActionState, useState } from "react";
import { toTrLocalInput } from "@/lib/clock";
import { CalendarClock, ListTodo, Pencil } from "lucide-react";
import { updateTask, type TaskResult } from "@/app/actions/tasks";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

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

// datetime-local değeri Türkiye saatiyle (tarayıcı saat diliminden bağımsız; sunucu da aynı yorumla kaydeder).
function toLocalInput(iso: string | null) {
  return iso ? toTrLocalInput(iso) : "";
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
  const fieldClass =
    "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";
  /* Popup yok: sayfa içi sekme alanı (InlineTabbedPanel). Action ve alan adları değişmedi. */
  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Görevi düzenle"
      description={task.title}
      icon={<Pencil />}
      action={action}
      pending={pending}
      error={state.error}
      hiddenFields={<input type="hidden" name="id" value={task.id} />}
      fieldLabels={{ title: "Başlık", kind: "Tür", priority: "Öncelik", due_at: "Son tarih", recurrence: "Tekrar", notes: "Not" }}
      trigger={({ onClick, ...aria }) =>
        variant === "overlay" ? (
          <button
            type="button"
            onClick={onClick}
            {...aria}
            aria-label={`${task.title} görevini düzenle`}
            className="focus-ring absolute inset-0 cursor-pointer rounded-[var(--radius-card)]"
          />
        ) : (
          <button
            type="button"
            onClick={onClick}
            {...aria}
            aria-label="Görevi düzenle"
            className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-hairline text-text-muted transition hover:border-brand-300"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )
      }
      tabs={[
        { id: "genel", label: "Genel", icon: ListTodo, fields: ["title", "kind", "priority", "notes"] },
        { id: "zaman", label: "Zamanlama", icon: CalendarClock, fields: ["due_at", "recurrence"] },
      ]}
      panels={{
        genel: (
          <>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Başlık
              <input name="title" required defaultValue={task.title} placeholder="Görev başlığı" className={`mt-1 ${fieldClass}`} />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Tür
              <select name="kind" defaultValue={task.kind} className={`mt-1 ${fieldClass}`}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Öncelik
              <select name="priority" defaultValue={task.priority} className={`mt-1 ${fieldClass}`}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-text-muted sm:col-span-2">
              Not
              <textarea name="notes" rows={3} defaultValue={task.notes ?? ""} placeholder="Not (opsiyonel)" className={`mt-1 ${fieldClass}`} />
            </label>
          </>
        ),
        zaman: (
          <>
            <label className="text-xs font-semibold text-text-muted">
              Son tarih
              <input
                name="due_at"
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={`mt-1 ${fieldClass}`}
              />
            </label>
            <label className="text-xs font-semibold text-text-muted">
              Tekrar
              <select
                name="recurrence"
                defaultValue={task.recurrence ?? ""}
                disabled={!due}
                className={`mt-1 ${fieldClass} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {RECURRENCES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {!due ? <span className="mt-1 block font-normal text-text-faint">Tekrar için önce son tarih seçin.</span> : null}
            </label>
          </>
        ),
      }}
    />
  );
}
