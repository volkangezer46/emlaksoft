"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, LockKeyhole, Send, Sparkles } from "lucide-react";
import { replyTicketAsStaff, type TicketResult } from "@/app/actions/tickets";
import { TicketAttachmentInput, uploadTicketFiles } from "@/app/app/destek/ticket-attachment-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TicketAttachmentVisibility } from "@/lib/ticket-attachments";

type ReplyState = TicketResult & { messageId?: string; warning?: string };
const initial: ReplyState = {};

export type TicketMacro = { id: string; title: string; body: string };

export function StaffReplyForm({
  ticketId,
  closed = false,
  macros = [],
  version,
}: {
  ticketId: string;
  closed?: boolean;
  macros?: TicketMacro[];
  /** İyimser eşzamanlılık kontrolü — bkz. support_tickets.version. */
  version: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [visibility, setVisibility] = useState<TicketAttachmentVisibility>("public");
  const [attachmentKey, setAttachmentKey] = useState(0);
  const [requestId, setRequestId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setRequestId(crypto.randomUUID()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const effectiveVisibility: TicketAttachmentVisibility = closed ? "internal" : visibility;

  const [state, action, pending] = useActionState(async (_prev: ReplyState, formData: FormData): Promise<ReplyState> => {
    const body = String(formData.get("body") ?? "").trim();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
    const replyData = new FormData();
    replyData.set("id", ticketId);
    replyData.set("body", body);
    replyData.set("visibility", effectiveVisibility);
    const stableRequestId = String(formData.get("request_id") ?? "");
    if (!stableRequestId) return { error: "Güvenli gönderim kimliği hazırlanıyor. Lütfen tekrar deneyin." };
    replyData.set("request_id", stableRequestId);
    replyData.set("expected_version", String(version));

    const result = (await replyTicketAsStaff({}, replyData)) as ReplyState;
    if (!result.ok) return result;

    const uploaded = await uploadTicketFiles({
      ticketId,
      messageId: result.messageId,
      visibility: effectiveVisibility,
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
            ? `Mesaj gönderildi; ${uploaded.uploaded} dosya yüklendi. ${uploaded.error ?? "Bazı dosyalar yüklenemedi."}`
            : `Mesaj gönderildi ancak dosya eklenemedi. ${uploaded.error ?? ""}`.trim(),
      };
    }
    return { ...result, warning: uploaded.uploaded ? `${uploaded.uploaded} dosya güvenle doğrulandı.` : undefined };
  }, initial);

  function insertMacro(body: string) {
    if (!textareaRef.current) return;
    textareaRef.current.value = body;
    textareaRef.current.focus();
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="request_id" value={requestId} />
      <div
        role="tablist"
        aria-label="Mesaj görünürlüğü"
        className="inline-flex rounded-[var(--radius-control)] border border-line bg-canvas/70 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={effectiveVisibility === "public"}
          aria-disabled={closed}
          disabled={closed}
          onClick={() => setVisibility("public")}
          className={cn(
            "focus-ring inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-semibold transition",
            effectiveVisibility === "public" ? "bg-surface text-brand-700 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950",
            closed && "cursor-not-allowed opacity-45",
          )}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden /> Müşteriye yanıt
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveVisibility === "internal"}
          onClick={() => setVisibility("internal")}
          className={cn(
            "focus-ring inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-semibold transition",
            effectiveVisibility === "internal" ? "bg-amber-400/15 text-amber-700 shadow-[var(--shadow-xs)]" : "text-text-muted hover:text-ink-950",
          )}
        >
          <LockKeyhole className="h-3.5 w-3.5" aria-hidden /> İç not
        </button>
      </div>

      <p className={cn("text-xs", effectiveVisibility === "internal" ? "font-medium text-amber-700" : "text-text-muted")}>
        {effectiveVisibility === "internal"
          ? closed
            ? "Kapalı ticket için yalnız operasyon iç notu eklenebilir; ofise bildirim gitmez."
            : "Yalnız yetkili EmlakSoft personeli görür; ofise bildirim gitmez."
          : "Yanıt ve public ekler ofis kullanıcılarına görünür."}
      </p>

      <div className="relative">
        <textarea
          aria-label="Yanıt metni"
          ref={textareaRef}
          name="body"
          required
          minLength={3}
          maxLength={20_000}
          rows={5}
          placeholder={effectiveVisibility === "internal" ? "Ekip için not yazın…" : "Ofise net ve uygulanabilir bir yanıt yazın…"}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          className={cn(
            "w-full resize-y rounded-[var(--radius-card)] border bg-canvas px-3 py-3 pr-32 text-sm leading-relaxed outline-none transition focus:bg-surface",
            effectiveVisibility === "internal" ? "border-amber-400/35 focus:border-amber-500" : "border-line focus:border-brand-400",
          )}
        />
        {macros.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="focus-ring absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-text-muted shadow-[var(--shadow-xs)] transition hover:border-brand-300 hover:text-brand-600"
              >
                <Sparkles className="h-3 w-3" /> Hazır yanıt
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Hazır yanıtlar</DropdownMenuLabel>
              {macros.map((macro) => (
                <DropdownMenuItem key={macro.id} onSelect={() => insertMacro(macro.body)}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{macro.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-text-faint">{macro.body}</p>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <TicketAttachmentInput key={attachmentKey} id={`staff-ticket-files-${ticketId}`} disabled={pending} compact />
        <Button type="submit" loading={pending} disabled={!requestId} icon={effectiveVisibility === "internal" ? LockKeyhole : Send}>
          {pending ? "Kaydediliyor…" : effectiveVisibility === "internal" ? "İç not ekle" : "Yanıtı gönder"}
        </Button>
      </div>
      <p className="text-xs text-text-faint sm:text-right">Hızlı gönderim: Ctrl/Command + Enter</p>
      {state.error ? <p className="text-sm font-medium text-danger-600" role="alert">{state.error}</p> : null}
      {state.warning ? <p className="text-sm font-medium text-amber-700" role="status" aria-live="polite">{state.warning}</p> : null}
    </form>
  );
}
