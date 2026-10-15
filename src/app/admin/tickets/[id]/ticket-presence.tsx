"use client";

import { useEffect, useState } from "react";
import { Eye, PenLine } from "lucide-react";
import { loadRealtimeClient } from "@/lib/realtime";
import { TICKET_TYPING_EVENT, othersFromPresence, presenceSummary, type DeskPresence, type TicketTypingDetail } from "@/lib/support/ticket-collision";

/**
 * PA-8 personel çakışma şeridi: aynı talebi açık tutan diğer destek personeli ("Ayşe bakıyor", "Mehmet yazıyor…").
 * Supabase Realtime PRESENCE, özel konu `ticket-desk:<id>` (migration 20261019070002: yalnız aktif personel).
 * Yazıyor bayrağı yanıt formundan pencere olayıyla gelir (`TICKET_TYPING_EVENT`). Kanal kurulamazsa (politika yok,
 * çevrimdışı) şerit sessizce gizli kalır; gönderim öncesi "yeni mesaj geldi" kontrolü sunucuda ayrıca çalışır.
 */
export function TicketPresence({ ticketId, viewerId, viewerName }: { ticketId: string; viewerId: string; viewerName: string }) {
  const [others, setOthers] = useState<DeskPresence[]>([]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void loadRealtimeClient().then((supabase) => {
      if (cancelled || !supabase) return;
      const channel = supabase.channel(`ticket-desk:${ticketId}`, { config: { private: true, presence: { key: viewerId } } });
      let typing = false;
      const track = () => void channel.track({ name: viewerName, typing }).catch(() => undefined);
      channel.on("presence", { event: "sync" }, () => {
        setOthers(othersFromPresence(channel.presenceState() as Record<string, unknown[]>, viewerId));
      });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") track();
        // Politika yok / yetki reddi: yeniden deneme döngüsüne girmeden kanal bırakılır (şerit gizli kalır).
        else if (status === "CHANNEL_ERROR") void supabase.removeChannel(channel);
      });
      const onTyping = (e: Event) => {
        const d = (e as CustomEvent<TicketTypingDetail>).detail;
        if (!d || d.ticketId !== ticketId || d.typing === typing) return;
        typing = d.typing;
        track();
      };
      window.addEventListener(TICKET_TYPING_EVENT, onTyping);
      cleanup = () => {
        window.removeEventListener(TICKET_TYPING_EVENT, onTyping);
        void supabase.removeChannel(channel);
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
      setOthers([]);
    };
  }, [ticketId, viewerId, viewerName]);

  const summary = presenceSummary(others);
  return (
    <div aria-live="polite" className="min-h-0">
      {others.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={summary}>
          {others.map((o) => (
            <li key={o.id} className={`ds-pill ${o.typing ? "pm-t-warn" : "pm-t-brand"}`} title={o.typing ? `${o.name} şu anda yanıt yazıyor` : `${o.name} bu talebi açık tutuyor`}>
              {o.typing ? <PenLine className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              <span className="max-w-40 truncate">{o.name}</span>
              <span className="text-[0.6875rem] font-semibold">{o.typing ? "yazıyor…" : "bakıyor"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
