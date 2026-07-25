"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ListPlus, Plus } from "lucide-react";
import { createTask } from "@/app/actions/tasks";
import { Combobox } from "@/components/ui/combobox";
import { searchCustomers } from "@/app/actions/lookup";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

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
    /* Radix Dialog: focus trap + Esc (öncesinde YOKTU) + scroll lock + ARIA.
       Görünüm birebir korundu — DialogHeader zaten bu tasarımın kendisi. */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[11px] bg-white px-4 py-2.5 text-sm font-bold text-ink-950 shadow-[var(--elev-2)]"
        >
          <Plus className="h-4 w-4" /> Yeni görev
        </button>
      </DialogTrigger>

      <DialogContent size="lg">
        <DialogHeader
          icon={<ListPlus />}
          title="Yeni görev ekle"
          description="Takip, arama, ziyaret veya evrak görevi planlayın."
        />
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
              {/* Yalnızca müşteri listesi Combobox'a alındı. "Atanan" ekip
                  listesi en fazla birkaç düzine kişi; orada native <select>
                  hâlâ daha iyi (mobilde OS seçicisi, sıfır JS). */}
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-ink-950">İlgili müşteri</span>
                <Combobox
                  name="customer_id"
                  aria-label="İlgili müşteri"
                  placeholder="Seçiniz (opsiyonel)"
                  searchPlaceholder="Müşteri ara…"
                  emptyText="Eşleşen müşteri yok"
                  onSearch={searchCustomers}
                  options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-ink-950" htmlFor="task-notes">Not</label>
                <textarea id="task-notes" name="notes" rows={2} className={`${fieldClass} resize-none`} placeholder="Detay, hazırlık, dikkat edilecekler…" />
              </div>

              {error ? <p className="sm:col-span-2 text-sm text-danger-500" role="alert">{error}</p> : null}

              <div className="hairline-t sm:col-span-2 flex items-center justify-end gap-2 pt-4">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button type="submit" disabled={pending} className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  <Check className="h-4 w-4" /> {pending ? "Ekleniyor…" : "Görevi ekle"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
