"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Eye, LockKeyhole, Send, Sparkles, X } from "lucide-react";
import { replyTicketAsStaff, type TicketResult } from "@/app/actions/tickets";
import { applyTicketMacroActions } from "@/app/actions/support-desk";
import { renderMacroBody, type MacroVariables } from "@/lib/support/macro-template";
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
import { subscribeToInserts } from "@/lib/realtime";
import { TICKET_TYPING_EVENT, type NewMessagePreview, type TicketTypingDetail } from "@/lib/support/ticket-collision";

type ReplyState = TicketResult & { messageId?: string; warning?: string };
const initial: ReplyState = {};

export type TicketMacro = {
  id: string;
  title: string;
  body: string;
  /** Gönderimde uygulanacak eylemlerin okunur özeti (boşsa yalnız metin + kullanım sayacı). */
  actionSummary?: string[];
};

export function StaffReplyForm({
  ticketId,
  closed = false,
  macros = [],
  macroVars = {},
  version,
  lastMessageAt = null,
  viewerId,
}: {
  ticketId: string;
  closed?: boolean;
  macros?: TicketMacro[];
  /** Makro değişkenleri ({{ofis.ad}} …) — sunucuda hazırlanır, seçimde tarayıcıda anında doldurulur. */
  macroVars?: MacroVariables;
  /** İyimser eşzamanlılık kontrolü — bkz. support_tickets.version. */
  version: number;
  /** PA-8: sayfa çizildiğindeki en yeni mesaj anı; gönderimde sunucu bundan sonra başkası yazdı mı diye bakar. */
  lastMessageAt?: string | null;
  /** Personel kimliği: canlı gelen kendi mesajı "yeni mesaj" sayılmaz. */
  viewerId?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [visibility, setVisibility] = useState<TicketAttachmentVisibility>("public");
  const [attachmentKey, setAttachmentKey] = useState(0);
  const [requestId, setRequestId] = useState("");
  const [activeMacro, setActiveMacro] = useState<TicketMacro | null>(null);
  // PA-8: "okudum" ile ilerleyen işaret (sayfa işaretinden yeni ise o geçerli) + canlı gelen yeni mesajlar.
  const [ackAt, setAckAt] = useState<string | null>(null);
  const [liveNew, setLiveNew] = useState<NewMessagePreview[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const seenAt = [lastMessageAt, ackAt].filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => setRequestId(crypto.randomUUID()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Siz yazarken başkası mesaj eklerse formun üstünde uyarı (postgres_changes; personel RLS'i okur).
  useEffect(() => {
    return subscribeToInserts<{ id: string; ticket_id: string; author_kind: string; author_user_id: string | null; body: string; visibility: string; created_at: string }>({
      channel: `es-rt-reply-guard:${ticketId}`,
      table: "support_ticket_messages",
      filter: `ticket_id=eq.${ticketId}`,
      onInsert: (row) => {
        if (viewerId && row.author_user_id === viewerId) return;
        setLiveNew((prev) => [
          ...prev.slice(-4),
          {
            author: row.author_kind === "staff" ? "Destek personeli" : row.author_kind === "system" ? "Sistem" : "Ofis",
            excerpt: String(row.body ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
            at: row.created_at,
            internal: row.visibility === "internal",
          },
        ]);
      },
    });
  }, [ticketId, viewerId]);

  // Yazıyor bayrağı (presence şeridi bunu diğer personele yayar): ilk tuşta açılır, 4 sn duraksamada kapanır.
  function signalTyping(typing: boolean) {
    window.dispatchEvent(new CustomEvent<TicketTypingDetail>(TICKET_TYPING_EVENT, { detail: { ticketId, typing } }));
  }
  function onDraftInput(value: string) {
    setHasDraft(value.trim().length > 0);
    signalTyping(value.trim().length > 0);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => signalTyping(false), 4000);
  }
  useEffect(
    () => () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    },
    [],
  );

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
    const seen = String(formData.get("seen_at") ?? "");
    if (seen) replyData.set("seen_at", seen);
    if (formData.get("force") === "1") replyData.set("force", "1");

    const result = (await replyTicketAsStaff({}, replyData)) as ReplyState;
    if (result.newMessages?.length) {
      // Gönderilmedi: konuşma tazelenir, metin formda kalır; personel okuyup "yine de gönder" der.
      startTransition(() => router.refresh());
      return result;
    }
    if (!result.ok) {
      startTransition(() => router.refresh());
      return result;
    }
    signalTyping(false);

    // Makro eylemleri (durum/öncelik/atama/etiket) + kullanım sayacı, yanıt kaydedildikten SONRA.
    let macroWarning: string | undefined;
    const macroId = String(formData.get("macro_id") ?? "");
    if (macroId) {
      const macroData = new FormData();
      macroData.set("id", ticketId);
      macroData.set("macro_id", macroId);
      const applied = await applyTicketMacroActions(macroData);
      if (applied.error) macroWarning = applied.error;
    }

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
      setActiveMacro(null);
      setLiveNew([]);
      setHasDraft(false);
      router.refresh();
    });
    // Makro uyarısı yükleme sonucunu gizlemesin: ikisi de tek uyarı satırında gösterilir.
    const uploadNote = !uploaded.ok
      ? uploaded.uploaded > 0
        ? `Mesaj gönderildi; ${uploaded.uploaded} dosya yüklendi. ${uploaded.error ?? "Bazı dosyalar yüklenemedi."}`
        : `Mesaj gönderildi ancak dosya eklenemedi. ${uploaded.error ?? ""}`.trim()
      : uploaded.uploaded
        ? `${uploaded.uploaded} dosya güvenle doğrulandı.`
        : undefined;
    const warning = [macroWarning, uploadNote].filter(Boolean).join(" ");
    return { ...result, warning: warning || undefined };
  }, initial);

  function insertMacro(macro: TicketMacro) {
    if (!textareaRef.current) return;
    textareaRef.current.value = renderMacroBody(macro.body, macroVars);
    textareaRef.current.focus();
    setActiveMacro(macro);
  }

  // `<form action>` yerine onSubmit: React form eylemi bitince alanları sıfırlar; çakışma/hata durumunda yazılan yanıt
  // kaybolmasın diye sıfırlama yalnız başarıda elle yapılır.
  function submitWith(force: boolean) {
    const form = formRef.current;
    if (!form) return;
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    if (force) fd.set("force", "1");
    startTransition(() => action(fd));
  }
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submitWith(false);
  }
  const pendingNew = state.newMessages ?? [];
  const latestLive = liveNew.at(-1)?.at ?? null;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="seen_at" value={pendingNew.length ? (pendingNew[0]?.at ?? seenAt ?? "") : (seenAt ?? "")} />
      <input type="hidden" name="macro_id" value={activeMacro?.id ?? ""} />
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
          onInput={(event) => onDraftInput(event.currentTarget.value)}
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
                <DropdownMenuItem key={macro.id} onSelect={() => insertMacro(macro)}>
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

      {activeMacro ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-brand-300/40 bg-brand-600/[0.05] px-2.5 py-1.5 text-xs" role="status">
          <Sparkles className="h-3 w-3 text-brand-600" aria-hidden />
          <span className="font-semibold text-ink-950">{activeMacro.title}</span>
          {activeMacro.actionSummary?.length ? (
            <span className="text-text-muted">· gönderimde: {activeMacro.actionSummary.join(" · ")}</span>
          ) : (
            <span className="text-text-muted">· yalnız metin</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setActiveMacro(null)}
            aria-label="Makro eylemlerini kaldır"
            className="ml-auto rounded-full text-text-faint hover:text-danger-600"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      {liveNew.length > 0 && hasDraft && pendingNew.length === 0 ? (
        <div className="flex flex-wrap items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800" role="status" aria-live="polite">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            Siz yazarken {liveNew.length} yeni mesaj geldi: <span className="font-semibold">{liveNew.at(-1)?.author}</span> — “{liveNew.at(-1)?.excerpt}”
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              if (latestLive) setAckAt(latestLive);
              setLiveNew([]);
            }}
          >
            Okudum
          </Button>
        </div>
      ) : null}

      {pendingNew.length > 0 ? (
        <div className="space-y-2 rounded-[var(--radius-card)] border border-amber-400/45 bg-amber-400/10 p-3" role="alert">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <BellRing className="h-4 w-4 shrink-0" aria-hidden /> Siz yazarken {pendingNew.length} yeni mesaj geldi; yanıtınız henüz gönderilmedi.
          </p>
          <ul className="space-y-1.5">
            {pendingNew.map((m) => (
              <li key={`${m.at}-${m.author}`} className="rounded-[var(--radius-control)] bg-surface px-2.5 py-1.5 text-xs text-text">
                <span className="font-semibold text-ink-950">{m.author}</span>
                {m.internal ? <span className="ml-1 text-amber-700">(iç not)</span> : null}: {m.excerpt}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={() => textareaRef.current?.focus()}>
              Yanıtı düzenle
            </Button>
            <Button type="button" size="sm" loading={pending} onClick={() => submitWith(true)} icon={Send}>
              Yine de gönder
            </Button>
          </div>
        </div>
      ) : null}

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
