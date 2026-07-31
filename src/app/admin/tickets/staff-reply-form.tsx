"use client";

import { useActionState, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles } from "lucide-react";
import { replyTicketAsStaff, type TicketResult } from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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

  function insertMacro(body: string) {
    if (!textareaRef.current) return;
    textareaRef.current.value = body;
    textareaRef.current.focus();
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="id" value={ticketId} />
      <div className="relative">
        <textarea
          ref={textareaRef}
          name="body"
          required
          rows={4}
          placeholder="Ofise yanıt yazın…"
          className="w-full resize-none rounded-[12px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
        />
        {macros.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="focus-ring absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-muted shadow-[var(--shadow-xs)] transition hover:border-brand-300 hover:text-brand-600"
              >
                <Sparkles className="h-3 w-3" /> Hazır yanıt
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Hazır yanıtlar</DropdownMenuLabel>
              {macros.map((m) => (
                <DropdownMenuItem key={m.id} onSelect={() => insertMacro(m.body)}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{m.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-text-faint">{m.body}</p>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {state.error ? <p className="text-sm text-danger-500" role="alert">{state.error}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" loading={pending} icon={Send}>
          {pending ? "Gönderiliyor…" : "Yanıtla"}
        </Button>
      </div>
    </form>
  );
}
