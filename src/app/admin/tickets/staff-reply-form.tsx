"use client";

import { useActionState, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { replyTicketAsStaff, type TicketResult } from "@/app/actions/tickets";

const initial: TicketResult = {};

export type TicketMacro = { id: string; title: string; body: string };

export function StaffReplyForm({
  ticketId,
  disabled,
  macros = [],
}: {
  ticketId: string;
  disabled?: boolean;
  macros?: TicketMacro[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [state, action, pending] = useActionState(async (prev: TicketResult, formData: FormData) => {
    const result = await replyTicketAsStaff(prev, formData);
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
        Kapalı ticket’a yanıt eklenemez. Durumu yeniden açabilirsiniz.
      </p>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="id" value={ticketId} />
      {macros.length > 0 ? (
        <select
          aria-label="Hazır yanıt seç"
          defaultValue=""
          onChange={(e) => {
            // Seçilen makro metni textarea'ya dolar; select geri sıfırlanır
            const macro = macros.find((m) => m.id === e.target.value);
            if (macro && textareaRef.current) {
              textareaRef.current.value = macro.body;
              textareaRef.current.focus();
            }
            e.target.value = "";
          }}
          className="w-full rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-text-muted outline-none focus:border-brand-400"
        >
          <option value="">Hazır yanıt seç…</option>
          {macros.map((m) => (
            <option key={m.id} value={m.id}>{m.title}</option>
          ))}
        </select>
      ) : null}
      <textarea
        ref={textareaRef}
        name="body"
        required
        rows={4}
        placeholder="Ofise yanıt yazın…"
        className="w-full resize-none rounded-[12px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
      />
      {state.error ? <p className="text-sm text-danger-500" role="alert">{state.error}</p> : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
        >
          <Send className="h-3.5 w-3.5" />
          {pending ? "Gönderiliyor…" : "Yanıtla"}
        </button>
      </div>
    </form>
  );
}
