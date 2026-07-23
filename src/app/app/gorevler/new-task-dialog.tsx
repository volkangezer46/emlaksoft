"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ListPlus, Plus, X } from "lucide-react";
import { createTask } from "@/app/actions/tasks";

type Option = { id: string; full_name: string };

const fieldClass =
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

const kindOptions = [
  { value: "followup", label: "Takip" },
  { value: "call", label: "Arama" },
  { value: "visit", label: "Ziyaret" },
  { value: "document", label: "Evrak" },
  { value: "other", label: "Diğer" },
];

export function NewTaskDialog({ members, customers }: { members: Option[]; customers: Option[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await createTask({}, formData);
    setPending(false);
    if (result.ok) {
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
      return;
    }
    setError(result.error ?? "Görev oluşturulamadı.");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--shadow-sm)]"
      >
        <Plus className="h-4 w-4" /> Yeni görev
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/55 p-4 backdrop-blur-md sm:items-center">
          <div className="w-full max-w-2xl overflow-hidden rounded-[22px] border border-white/20 bg-surface shadow-[var(--shadow-lg)]">
            <div className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] px-6 py-5 text-white">
              <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/10 text-mint-400"><ListPlus className="h-5 w-5" /></span>
                  <div>
                    <h2 className="font-display text-lg font-bold text-white">Yeni görev ekle</h2>
                    <p className="text-xs text-white/55">Takip, arama, ziyaret veya evrak görevi planlayın.</p>
                  </div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-[10px] bg-white/8 text-white/70 transition hover:bg-white/15 hover:text-white" aria-label="Kapat">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form ref={formRef} action={submit} className="grid gap-4 p-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-title">Başlık *</label>
                <input id="task-title" name="title" required className={fieldClass} placeholder="Örn. Ahmet Bey'i geri ara" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-kind">Tür</label>
                <div className="relative">
                  <select id="task-kind" name="kind" defaultValue="followup" className={`${fieldClass} appearance-none`}>
                    {kindOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-priority">Öncelik</label>
                <div className="relative">
                  <select id="task-priority" name="priority" defaultValue="normal" className={`${fieldClass} appearance-none`}>
                    <option value="low">Düşük</option>
                    <option value="normal">Normal</option>
                    <option value="high">Yüksek</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-due">Son tarih</label>
                <input id="task-due" name="due_at" type="datetime-local" className={fieldClass} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-assignee">Atanan</label>
                <div className="relative">
                  <select id="task-assignee" name="assigned_to" defaultValue="" className={`${fieldClass} appearance-none`}>
                    <option value="">Bana ata</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-customer">İlgili müşteri</label>
                <div className="relative">
                  <select id="task-customer" name="customer_id" defaultValue="" className={`${fieldClass} appearance-none`}>
                    <option value="">Seçiniz (opsiyonel)</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-notes">Not</label>
                <textarea id="task-notes" name="notes" rows={2} className={`${fieldClass} resize-none`} placeholder="Detay, hazırlık, dikkat edilecekler…" />
              </div>

              {error ? <p className="sm:col-span-2 text-sm text-danger-500" role="alert">{error}</p> : null}

              <div className="sm:col-span-2 flex items-center justify-end gap-2 border-t border-line pt-4">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">Vazgeç</button>
                <button type="submit" disabled={pending} className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  <Check className="h-4 w-4" /> {pending ? "Ekleniyor…" : "Görevi ekle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
