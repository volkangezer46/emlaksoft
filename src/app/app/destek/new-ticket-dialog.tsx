"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LifeBuoy, ShieldCheck } from "lucide-react";
import { createSupportTicket, type TicketResult } from "@/app/actions/tickets";
import { TicketAttachmentInput, uploadTicketFiles } from "./ticket-attachment-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";

type CreateState = TicketResult & { warning?: string };
const initial: CreateState = {};

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
  const [requestId, setRequestId] = useState("");
  const [attachmentKey, setAttachmentKey] = useState(0);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setRequestId(crypto.randomUUID()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const [state, action, pending] = useActionState<CreateState, FormData>(async (_previous, formData) => {
    const stableRequestId = String(formData.get("request_id") ?? "");
    if (!stableRequestId) return { error: "Güvenli gönderim kimliği hazırlanıyor. Lütfen tekrar deneyin." };

    const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    const ticketData = new FormData();
    for (const field of ["subject", "body", "category", "priority"] as const) {
      ticketData.set(field, String(formData.get(field) ?? ""));
    }
    ticketData.set("request_id", stableRequestId);

    const result = await createSupportTicket({}, ticketData);
    if (!result.ok) return result;
    if (!result.ticketId) return { error: "Talep oluşturuldu ancak güvenli referansı alınamadı." };

    const uploaded = await uploadTicketFiles({
      ticketId: result.ticketId,
      visibility: "public",
      files,
    });

    startTransition(() => {
      formRef.current?.reset();
      setAttachmentKey((value) => value + 1);
      setRequestId(crypto.randomUUID());
    });

    if (!uploaded.ok) {
      return {
        ...result,
        warning:
          uploaded.uploaded > 0
            ? `Talep oluşturuldu ve ${uploaded.uploaded} dosya eklendi; bazı dosyalar eklenemedi. ${uploaded.error ?? ""}`.trim()
            : `Talep oluşturuldu ancak dosya eklenemedi. ${uploaded.error ?? ""}`.trim(),
      };
    }

    startTransition(() => {
      setOpen(false);
      router.push(`/app/destek/${result.ticketId}`);
      router.refresh();
    });
    return result;
  }, initial);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="btn-shine focus-ring press inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-white px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-white/90"
        >
          <LifeBuoy className="h-4 w-4" aria-hidden /> Yeni talep
        </button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<LifeBuoy />}
          title="Destek talebi"
          description="Sorunu, beklenen sonucu ve denediğiniz adımları paylaşın."
        />
        <form ref={formRef} action={action} className="grid gap-4 p-6">
          <input type="hidden" name="request_id" value={requestId} />
          <div>
            <label className="mb-1.5 block text-sm text-text-muted" htmlFor="subject">Konu *</label>
            <input
              id="subject"
              name="subject"
              required
              minLength={3}
              maxLength={200}
              className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
              placeholder="Örn. Portal ilanım yayına gitmiyor"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-text-muted" htmlFor="category">Kategori</label>
              <select id="category" name="category" defaultValue="general" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-text-muted" htmlFor="priority">Öncelik</label>
              <select id="priority" name="priority" defaultValue="normal" className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400">
                <option value="low">Düşük</option>
                <option value="normal">Normal</option>
                <option value="high">Yüksek</option>
                <option value="urgent">Acil</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted" htmlFor="body">Açıklama *</label>
            <textarea
              id="body"
              name="body"
              required
              minLength={3}
              maxLength={20_000}
              rows={6}
              className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm leading-relaxed outline-none transition focus:border-brand-400 focus:bg-surface"
              placeholder="Ne oldu, ne olmasını bekliyordunuz ve hangi adımları denediniz?"
            />
          </div>
          <TicketAttachmentInput key={attachmentKey} id="new-ticket-files" disabled={pending} />
          <p className="flex items-center gap-1.5 text-xs text-text-faint">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-600" aria-hidden /> Dosyalar private depoda içerik ve bütünlük denetiminden geçirilir.
          </p>
          {state.error ? <p className="text-sm font-medium text-danger-600" role="alert">{state.error}</p> : null}
          {state.warning ? (
            <div className="rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-800" role="status">
              <p>{state.warning}</p>
              {state.ticketId ? <Link href={`/app/destek/${state.ticketId}`} className="mt-1 inline-block font-semibold underline">Oluşturulan talebe git</Link> : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <button type="button" className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">Vazgeç</button>
            </DialogClose>
            <button type="submit" disabled={pending || !requestId} className="btn-shine focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? "Gönderiliyor…" : "Talep oluştur"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
