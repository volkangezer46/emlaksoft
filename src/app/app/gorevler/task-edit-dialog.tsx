"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import { updateTask, type TaskResult } from "@/app/actions/tasks";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  priority: string;
  due_at: string | null;
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

// datetime-local için yerel saate göre biçimlendirme (UTC kaymasını önle)
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function TaskEditDialog({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Düzenle"
        className="grid h-8 w-8 place-items-center rounded-[9px] border border-line text-text-muted hover:border-brand-300"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-ink-950/40 p-4 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Görev düzenle"
              tabIndex={-1}
              className="w-full max-w-md rounded-[20px] border border-line bg-surface p-5 shadow-xl outline-none"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display font-bold text-ink-950">Görevi Düzenle</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-canvas"
                  aria-label="Kapat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form action={action} className="grid gap-3">
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
                    defaultValue={toLocalInput(task.due_at)}
                    className="mt-1 w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                  />
                </label>
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={task.notes ?? ""}
                  placeholder="Not (opsiyonel)"
                  className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
                />
                {state.error && <p className="text-xs font-semibold text-red-600">{state.error}</p>}
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-text-muted transition hover:bg-canvas"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    {pending ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
