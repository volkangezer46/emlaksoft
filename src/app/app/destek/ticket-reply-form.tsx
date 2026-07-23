"use client";

import { useActionState, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { replyTicketAsTenant, type TicketResult } from "@/app/actions/tickets";

const initial: TicketResult = {};

export function TicketReplyForm({ ticketId, disabled }: { ticketId: string; disabled?: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState(async (prev: TicketResult, formData: FormData) => {
    const result = await replyTicketAsTenant(prev, formData);
    if (result.ok) {
      startTransition(() => {
        formRef.current?.reset();
        router.refresh();
      });
    }
    return result;
  }, initial);

  if (disabled) {
    return (
      <p className="rounded-[12px] border border-line bg-canvas/70 px-4 py-3 text-sm text-text-muted">
        Bu talep kapatıldı. Yeni bir sorun için yeni talep oluşturun.
      </p>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="id" value={ticketId} />
      <textarea
        name="body"
        required
        rows={3}
        placeholder="Yanıtınızı yazın…"
        className="w-full resize-none rounded-[12px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
      />
      {state.error ? <p className="text-sm text-danger-500" role="alert">{state.error}</p> : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <Send className="h-3.5 w-3.5" />
          {pending ? "Gönderiliyor…" : "Yanıt gönder"}
        </button>
      </div>
    </form>
  );
}
