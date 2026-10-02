"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, LifeBuoy, LockKeyhole, Shield, Sparkles } from "lucide-react";
import { subscribeToInserts } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  TicketAttachmentList,
  type TicketAttachmentDisplay,
} from "./ticket-attachment-list";

export type TicketMessage = {
  id: string;
  body: string;
  author_kind: string;
  author_user_id: string | null;
  visibility: "public" | "internal";
  created_at: string;
};

type LiveMessage = TicketMessage & { live?: boolean };

function dt(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

function safeMessages(messages: TicketMessage[], audience: "tenant" | "staff") {
  const filtered = audience === "tenant" ? messages.filter((message) => message.visibility === "public") : messages;
  return [...filtered].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Tek konuşma bileşeni iki güven sınırını korur: tenant görünümünde sunucudan
 * yanlışlıkla gelse dahi internal satır render edilmez ve Realtime callback'i
 * internal payload'ı reddeder. RLS ana sınırdır; bu ikinci savunmadır.
 */
export function TicketThread({
  ticketId,
  initial,
  names,
  attachments = [],
  audience = "tenant",
  currentUserId,
}: {
  ticketId: string;
  initial: TicketMessage[];
  names: Record<string, string>;
  attachments?: TicketAttachmentDisplay[];
  audience?: "tenant" | "staff";
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const [liveItems, setLiveItems] = useState<LiveMessage[]>([]);
  const [announcement, setAnnouncement] = useState("");

  const items = useMemo<LiveMessage[]>(() => {
    const next = safeMessages(initial, audience);
    const liveById = new Map(liveItems.map((message) => [message.id, message]));
    const merged: LiveMessage[] = next.map((message) => (liveById.has(message.id) ? { ...message, live: true } : message));
    const nextIds = new Set(next.map((message) => message.id));
    const realtimeExtras = liveItems.filter((message) => !nextIds.has(message.id));
    return [...merged, ...realtimeExtras].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [audience, initial, liveItems]);

  useEffect(() => {
    if (!ticketId) return;
    return subscribeToInserts<TicketMessage & { ticket_id: string }>({
      channel: `es-rt-ticket:${audience}:${ticketId}`,
      table: "support_ticket_messages",
      filter: `ticket_id=eq.${ticketId}`,
      onInsert: (row) => {
        if (audience === "tenant" && row.visibility !== "public") return;
        setLiveItems((previous) => {
          if (previous.some((message) => message.id === row.id)) return previous;
          return [...previous, { ...row, live: true }].sort((a, b) => a.created_at.localeCompare(b.created_at));
        });
        setAnnouncement(row.author_kind === "staff" ? "Destek ekibinden yeni yanıt geldi." : "Yeni mesaj eklendi.");
      },
    });
  }, [audience, ticketId]);

  useEffect(() => {
    if (!ticketId) return;
    return subscribeToInserts<TicketAttachmentDisplay & { ticket_id: string }>({
      channel: `es-rt-ticket-attachments:${audience}:${ticketId}`,
      table: "support_ticket_attachments",
      filter: `ticket_id=eq.${ticketId}`,
      onInsert: (row) => {
        if (audience === "tenant" && row.visibility !== "public") return;
        router.refresh();
        setAnnouncement("Konuşmaya güvenli bir dosya eklendi.");
      },
    });
  }, [audience, router, ticketId]);

  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, TicketAttachmentDisplay[]>();
    for (const attachment of attachments) {
      if (!attachment.message_id) continue;
      if (audience === "tenant" && attachment.visibility !== "public") continue;
      const list = map.get(attachment.message_id) ?? [];
      list.push(attachment);
      map.set(attachment.message_id, list);
    }
    return map;
  }, [attachments, audience]);

  return (
    <section aria-label="Destek konuşması" className="space-y-3">
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      <style>{`
        @keyframes es-msg-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes es-msg-glow {
          from { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-600) 22%, transparent); }
          to { box-shadow: 0 0 0 3px transparent; }
        }
        .es-msg-new { animation: es-msg-in 0.35s ease-out, es-msg-glow 1.6s ease-out; }
        @media (prefers-reduced-motion: reduce) { .es-msg-new { animation: none; } }
      `}</style>

      {items.map((message) => {
        const isStaff = message.author_kind === "staff";
        const isSystem = message.author_kind === "system";
        const internal = message.visibility === "internal";
        const name = isSystem
          ? "EmlakSoft sistemi"
          : names[message.author_user_id ?? ""] ?? (isStaff ? "EmlakSoft Destek" : "Ofis kullanıcısı");
        const messageAttachments = attachmentsByMessage.get(message.id) ?? [];

        return (
          <article
            key={message.id}
            className={cn(
              "relative overflow-hidden rounded-[16px] border p-4 sm:p-5",
              internal
                ? "border-amber-400/35 bg-[linear-gradient(135deg,rgba(245,158,11,.08),rgba(255,255,255,.92))]"
                : isStaff
                  ? "border-cyan-400/25 bg-[linear-gradient(135deg,rgba(6,182,212,.055),rgba(255,255,255,.96))]"
                  : isSystem
                    ? "border-line bg-canvas/60"
                    : "border-line bg-surface",
              message.live && "es-msg-new",
            )}
          >
            {internal ? <div className="absolute inset-y-0 left-0 w-1 bg-amber-400" aria-hidden /> : null}
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-[11px]",
                  internal
                    ? "bg-amber-400/15 text-amber-700"
                    : isStaff
                      ? "bg-cyan-500/12 text-cyan-700"
                      : isSystem
                        ? "bg-ink-950/8 text-text-muted"
                        : "bg-brand-600/10 text-brand-700",
                )}
              >
                {internal ? <LockKeyhole className="h-4 w-4" aria-hidden /> : isStaff ? <Shield className="h-4 w-4" aria-hidden /> : isSystem ? <Sparkles className="h-4 w-4" aria-hidden /> : <Building2 className="h-4 w-4" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-950">{name}</p>
                <p className="text-[11px] text-text-faint">{dt(message.created_at)}</p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
                  internal
                    ? "bg-amber-400/15 text-amber-700"
                    : isStaff
                      ? "bg-cyan-500/10 text-cyan-700"
                      : "bg-brand-600/8 text-brand-700",
                )}
              >
                {internal ? "İç not" : isStaff ? "EmlakSoft" : isSystem ? "Sistem" : "Ofis"}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-ink-950/90">{message.body}</p>
            <TicketAttachmentList
              attachments={messageAttachments}
              currentUserId={currentUserId}
              canDeleteAll={audience === "staff"}
              label={internal ? "İç ekler" : "Ek dosyalar"}
            />
          </article>
        );
      })}

      {items.length === 0 ? (
        <div className="grid place-items-center rounded-[16px] border border-dashed border-line px-4 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-600/10 text-brand-700">
            <LifeBuoy className="h-5 w-5" aria-hidden />
          </span>
          <p className="mt-2 text-sm font-semibold text-ink-950">Konuşma henüz başlamadı</p>
          <p className="mt-0.5 text-xs text-text-muted">İlk mesaj gönderildiğinde burada görünecek.</p>
        </div>
      ) : null}
    </section>
  );
}
