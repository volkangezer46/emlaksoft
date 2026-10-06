import type { TimelineEvent } from "@/lib/activity-timeline";
import { daysUntilOfferExpiry } from "@/lib/offer-expiry";

/**
 * Teklif zaman çizelgesi (saf): oluşturma, sunum, pazarlık turları, yanıt, geçerlilik ve anlaşma bağı.
 * Veri sayfanın zaten okuduğu teklif + tur satırlarından gelir (ek sorgu yok).
 */
export function buildOfferEvents(input: {
  offer: {
    id: string;
    status: string;
    created_at: string;
    submitted_at: string | null;
    responded_at: string | null;
    valid_until: string | null;
  };
  rounds: { id: string; round_no: number; side: string; amount: number | string; note: string | null; created_at: string }[];
  statusLabel: string;
  money: (n: number | null) => string;
  todayKey: string;
  deal: { id: string; stageLabel: string } | null;
}): TimelineEvent[] {
  const { offer, rounds, money } = input;
  const ev: TimelineEvent[] = [
    { id: "created", at: offer.created_at, category: "teklif", title: "Teklif oluşturuldu", icon: "offer", tone: "neutral" },
  ];
  if (offer.submitted_at) {
    ev.push({ id: "submitted", at: offer.submitted_at, category: "teklif", title: "Teklif sunuldu", icon: "offer", tone: "info" });
  }
  for (const r of rounds) {
    ev.push({
      id: `round-${r.id}`,
      at: r.created_at,
      category: "teklif",
      title: `Tur ${r.round_no} · ${r.side === "buyer" ? "Alıcı" : "Satıcı"} · ${money(Number(r.amount))}`,
      detail: r.note ?? undefined,
      icon: "money",
      tone: r.side === "buyer" ? "info" : "warn",
    });
  }
  if (offer.responded_at) {
    const tone = offer.status === "accepted" ? "success" : offer.status === "rejected" ? "danger" : "neutral";
    ev.push({ id: "responded", at: offer.responded_at, category: "teklif", title: `Yanıtlandı · ${input.statusLabel}`, icon: "history", tone });
  }
  if (offer.valid_until) {
    const left = daysUntilOfferExpiry(offer.valid_until, input.todayKey);
    const open = !["accepted", "rejected", "withdrawn"].includes(offer.status);
    ev.push({
      id: "valid-until",
      at: `${offer.valid_until.slice(0, 10)}T09:00:00+03:00`,
      category: "teklif",
      title:
        left == null || !open
          ? "Geçerlilik tarihi"
          : left < 0
            ? "Geçerlilik süresi doldu"
            : left === 0
              ? "Geçerlilik bugün bitiyor"
              : `Geçerlilik ${left} gün sonra bitiyor`,
      icon: "calendar",
      tone: open && left != null && left <= 2 ? "warn" : "neutral",
    });
  }
  if (input.deal) {
    ev.push({
      id: "deal",
      at: offer.responded_at ?? offer.created_at,
      category: "teklif",
      title: `Anlaşma · ${input.deal.stageLabel}`,
      icon: "deal",
      tone: "info",
      href: `/app/anlasmalar/${input.deal.id}`,
    });
  }
  return ev;
}
