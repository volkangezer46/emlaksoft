"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, X } from "lucide-react";
import { createSupportTicket, type TicketResult } from "@/app/actions/tickets";

const initial: TicketResult = {};

const DEFAULT_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "general", label: "Genel" },
  { value: "billing", label: "Abonelik / fatura" },
  { value: "bug", label: "Hata bildirimi" },
  { value: "feature", label: "Özellik isteği" },
  { value: "compliance", label: "İYS / KVKK" },
  { value: "onboarding", label: "Kurulum" },
];

export function NewTicketDialog({
  categoryOptions = DEFAULT_CATEGORY_OPTIONS,
}: {
  categoryOptions?: { value: string; label: string }[];
} = {}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (prev: TicketResult, formData: FormData) => {
    const result = await createSupportTicket(prev, formData);
    if (result.ok) {
      startTransition(() => {
        setOpen(false);
        formRef.current?.reset();
        router.refresh();
      });
    }
    return result;
  }, initial);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-shine inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
      >
        <LifeBuoy className="h-4 w-4" /> Yeni talep
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/40 p-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-lg rounded-[20px] border border-line bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="font-display text-lg font-bold text-ink-950">Destek talebi</h2>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-[8px] text-text-muted hover:bg-canvas" aria-label="Kapat">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form ref={formRef} action={action} className="grid gap-4 p-6">
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="subject">Konu *</label>
                <input id="subject" name="subject" required className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Örn. Fatura / portal teyit sorunu" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm text-text-muted" htmlFor="category">Kategori</label>
                  <select id="category" name="category" defaultValue="general" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                    {categoryOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-text-muted" htmlFor="priority">Öncelik</label>
                  <select id="priority" name="priority" defaultValue="normal" className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                    <option value="low">Düşük</option>
                    <option value="normal">Normal</option>
                    <option value="high">Yüksek</option>
                    <option value="urgent">Acil</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-text-muted" htmlFor="body">Açıklama *</label>
                <textarea id="body" name="body" required rows={5} className="w-full resize-none rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400" placeholder="Sorunu adım adım yazın…" />
              </div>
              {state.error ? <p className="text-sm text-danger-500" role="alert">{state.error}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-[10px] border border-line px-4 py-2.5 text-sm font-medium">Vazgeç</button>
                <button type="submit" disabled={pending} className="rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  {pending ? "Gönderiliyor…" : "Gönder"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
