"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, Shield } from "lucide-react";
import { subscribeToInserts } from "@/lib/realtime";

export type TicketMessage = {
  id: string;
  body: string;
  author_kind: string;
  author_user_id: string | null;
  created_at: string;
};

function dt(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Destek konuşması — canlı mesaj dizisi.
 * support_ticket_messages INSERT'lerini ticket_id filtresiyle dinler (RLS'li
 * client kanalı); yeni mesaj kayarak eklenir + hafif vurgu. Kendi gönderdiğin
 * mesaj hem Realtime'dan hem router.refresh sonrası `initial`dan gelebilir —
 * id dedupe ile tek görünür. Bağlantı yoksa event gelmez; mevcut davranış
 * (yanıt sonrası refresh) aynen çalışır.
 */
export function TicketThread({
  ticketId,
  initial,
  names,
}: {
  ticketId: string;
  initial: TicketMessage[];
  names: Record<string, string>;
}) {
  // `live`: satır Realtime ile geldi → giriş animasyonu uygulanır.
  type Msg = TicketMessage & { live?: boolean };
  const [items, setItems] = useState<Msg[]>(initial);

  // Sunucudan yeni `initial` (router.refresh) geldiğinde listeyi tazele —
  // render sırasında state ayarlama deseni (notification-bell ile aynı).
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setItems((prev) => {
      // Animasyon sınıfı korunur; Realtime ile eklenmiş ama henüz sunucu
      // listesinde olmayan satırlar da kaybolmaz.
      const liveIds = new Set(prev.filter((m) => m.live).map((m) => m.id));
      const merged: Msg[] = initial.map((i) => (liveIds.has(i.id) ? { ...i, live: true } : i));
      const extras = prev.filter((m) => m.live && !initial.some((i) => i.id === m.id));
      return extras.length ? [...merged, ...extras] : merged;
    });
  }

  useEffect(() => {
    if (!ticketId) return;
    return subscribeToInserts<TicketMessage & { ticket_id: string }>({
      channel: `es-rt-ticket:${ticketId}`,
      table: "support_ticket_messages",
      filter: `ticket_id=eq.${ticketId}`,
      onInsert: (row) => {
        setItems((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev; // dedupe (kendi mesajın)
          return [
            ...prev,
            {
              id: row.id,
              body: row.body,
              author_kind: row.author_kind,
              author_user_id: row.author_user_id,
              created_at: row.created_at,
              live: true,
            },
          ];
        });
      },
    });
  }, [ticketId]);

  return (
    <section className="space-y-3">
      {/* Yeni mesaj: kayarak giriş + kısa vurgu; hareket azaltmada kapalı. */}
      <style>{`
        @keyframes es-msg-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes es-msg-glow {
          from { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-600) 25%, transparent); }
          to { box-shadow: 0 0 0 3px transparent; }
        }
        .es-msg-new { animation: es-msg-in 0.35s ease-out, es-msg-glow 1.6s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .es-msg-new { animation: none; }
        }
      `}</style>
      {items.map((m) => {
        const isStaff = m.author_kind === "staff";
        const isSystem = m.author_kind === "system";
        const name = isSystem
          ? "Sistem"
          : names[m.author_user_id ?? ""] ?? (isStaff ? "EmlakSoft Destek" : "Ofis");
        return (
          <article
            key={m.id}
            className={`rounded-[16px] border p-4 ${
              isStaff
                ? "border-amber-400/25 bg-amber-400/5"
                : isSystem
                  ? "border-line bg-canvas/60"
                  : "border-line bg-surface"
            }${m.live ? " es-msg-new" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`grid h-8 w-8 place-items-center rounded-[10px] ${
                  isStaff ? "bg-amber-400/15 text-amber-600" : "bg-brand-600/10 text-brand-600"
                }`}
              >
                {isStaff ? <Shield className="h-4 w-4" /> : <LifeBuoy className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-950">{name}</p>
                <p className="text-[11px] text-text-faint">{dt(m.created_at)}</p>
              </div>
              {isStaff ? (
                <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-600">
                  EmlakSoft
                </span>
              ) : null}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink-950/90">{m.body}</p>
          </article>
        );
      })}
      {items.length === 0 ? (
        <p className="rounded-[16px] border border-dashed border-line px-4 py-10 text-center text-sm text-text-muted">
          Henüz mesaj yok.
        </p>
      ) : null}
    </section>
  );
}
