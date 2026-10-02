"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { replyTicketAsTenant, type TicketResult } from "@/app/actions/tickets";
import { TicketAttachmentInput, uploadTicketFiles } from "./ticket-attachment-input";

type ReplyState = TicketResult & { messageId?: string; warning?: string };
const initial: ReplyState = {};

export function TicketReplyForm({
  ticketId,
  disabled,
  version,
}: {
  ticketId: string;
  disabled?: boolean;
  /** İyimser eşzamanlılık kontrolü — bkz. support_tickets.version. */
  version: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [attachmentKey, setAttachmentKey] = useState(0);
  const [requestId, setRequestId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setRequestId(crypto.randomUUID()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const [state, action, pending] = useActionState(async (_previous: ReplyState, formData: FormData): Promise<ReplyState> => {
    const body = String(formData.get("body") ?? "").trim();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    const replyData = new FormData();
    replyData.set("id", ticketId);
    replyData.set("body", body);
    const stableRequestId = String(formData.get("request_id") ?? "");
    if (!stableRequestId) return { error: "Güvenli gönderim kimliği hazırlanıyor. Lütfen tekrar deneyin." };
    replyData.set("request_id", stableRequestId);
    replyData.set("expected_version", String(version));
    const result = (await replyTicketAsTenant({}, replyData)) as ReplyState;
    if (!result.ok) return result;

    const uploaded = await uploadTicketFiles({
      ticketId,
      messageId: result.messageId,
      visibility: "public",
      files,
    });
    startTransition(() => {
      formRef.current?.reset();
      setAttachmentKey((value) => value + 1);
      setRequestId(crypto.randomUUID());
      router.refresh();
    });
    if (!uploaded.ok) {
      return {
        ...result,
        warning:
          uploaded.uploaded > 0
            ? `Yanıtınız gönderildi; ${uploaded.uploaded} dosya yüklendi. ${uploaded.error ?? ""}`.trim()
            : `Yanıtınız gönderildi ancak dosya eklenemedi. ${uploaded.error ?? ""}`.trim(),
      };
    }
    return { ...result, warning: uploaded.uploaded ? `${uploaded.uploaded} dosya güvenle doğrulandı.` : undefined };
  }, initial);

  if (disabled) {
    return (
      <p className="rounded-[var(--radius-card)] border border-line bg-canvas/70 px-4 py-3 text-sm text-text-muted">
        Bu talep kapatıldı. Sorun devam ediyorsa talebi yeniden açabilirsiniz.
      </p>
    );
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="request_id" value={requestId} />
      <label htmlFor={`tenant-ticket-reply-${ticketId}`} className="sr-only">Destek ekibine yanıt</label>
      <textarea
        id={`tenant-ticket-reply-${ticketId}`}
        name="body"
        required
        minLength={3}
        maxLength={20_000}
        rows={4}
        placeholder="Yanıtınızı ve denediğiniz adımları yazın…"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="w-full resize-y rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-3 text-sm leading-relaxed outline-none transition focus:border-brand-400 focus:bg-surface"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <TicketAttachmentInput key={attachmentKey} id={`tenant-ticket-files-${ticketId}`} disabled={pending} compact />
        <button
          type="submit"
          disabled={pending || !requestId}
          className="focus-ring press inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          {pending ? "Gönderiliyor…" : "Yanıt gönder"}
        </button>
      </div>
      <p className="text-xs text-text-faint sm:text-right">Hızlı gönderim: Ctrl/Command + Enter</p>
      {state.error ? <p className="text-sm font-medium text-danger-600" role="alert">{state.error}</p> : null}
      {state.warning ? <p className="text-sm font-medium text-amber-700" role="status" aria-live="polite">{state.warning}</p> : null}
    </form>
  );
}
