"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { createSupportTicket, type TicketResult } from "@/app/actions/tickets";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

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
    /*
     * Radix Dialog'a taşındı. Bedava gelenler: focus trap, Esc ile kapatma
     * (bu dialogda HİÇ YOKTU), scroll lock, aria-modal + başlık ilişkisi,
     * kapanışta focus'un tetikleyici butona dönmesi.
     */
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[10px] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
        >
          <LifeBuoy className="h-4 w-4" /> Yeni talep
        </button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<LifeBuoy />}
          title="Destek talebi"
          description="Sorununuzu iletin; ekip destek kuyruğundan takip eder."
        />
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
              {state.error ? <p className="text-sm font-medium text-danger-600" role="alert">{state.error}</p> : null}
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
                    Vazgeç
                  </button>
                </DialogClose>
                <button type="submit" disabled={pending} className="btn-shine focus-ring press rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                  {pending ? "Gönderiliyor…" : "Gönder"}
                </button>
              </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
