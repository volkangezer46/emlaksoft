/**
 * Müşteri zekâsı — tek müşteri için AÇIKLANABİLİR etkileşim özeti (kural tabanlı, AI yok, sahte skor yok).
 *
 * Yeni formül YAZMAZ: sıcaklık `scoreCustomerHeat` (customer-state/heat.ts; liste/360 `heat` girdisiyle aynı okuyucudan gelir), ilk yanıt `measureLead`
 * (response-time/core.ts) çıktısıdır. Burada yalnız o çıktılar tek özette birleşir ve mevcut
 * "Sonraki en iyi eylem" kartının (musteriler/[id]/next-best-action.ts) KAPSAMADIĞI durumlar için
 * ek, gerekçeli öneriler üretilir (yanıt bekleyen mesaj, temas edilmemiş kayıt, talepsiz sıcak müşteri, uykuda).
 *
 * SAF: "şimdi" dışarıdan gelir.
 */
import { DAY_MS } from "@/lib/clock";
import { scoreCustomerHeat, type CustomerHeat, type CustomerHeatInputs } from "@/lib/customer-state/heat";
import { DEFAULT_SLA_MIN, measureLead, TOUCH_CHANNELS, type LeadResponse } from "@/lib/response-time/core";

export type IntelTouch = {
  at: string;
  /** Müşteriden gelen / ofisten giden / yönsüz (dahili). */
  direction: "inbound" | "outbound" | "internal";
  /** comm_channel değeri veya "call". */
  channel: string;
  /** Cevapsız çağrı: müşteri aradı, kimse açmadı (giden temas SAYILMAZ). */
  missed?: boolean;
};

export type CustomerIntelInput = {
  customerId: string;
  createdAt: string;
  blacklist: boolean;
  touches: readonly IntelTouch[];
  openDemands: number;
  hasOpenOfferOrDeal: boolean;
  /** Tek okuyucudan (lib/customer-state) gelen ısı; verilirse YENİDEN hesaplanmaz ve `heatApproximate` false olur. */
  heat?: CustomerHeat;
  /** `customer_heat_signals` RPC satırı; yoksa ısı yalnız temas/talep verisinden hesaplanır. */
  heatSignals: {
    last_contact: string | null;
    open_demands: number;
    urgent_demands: number;
    portal_likes_30d: number;
    open_offers: number;
    open_deals: number;
  } | null;
};

export type IntelSuggestion = {
  key: "yanit_bekleyen" | "temas_yok" | "talep_ac" | "uykuda";
  title: string;
  reason: string;
  href: string;
  cta: string;
};

export type CustomerIntel = {
  heat: CustomerHeat;
  /** Isı RPC verisi yoksa true: portal beğenisi/acil talep bileşenleri eksik olabilir. */
  heatApproximate: boolean;
  last30: { inbound: number; outbound: number };
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** Müşteri yazdı/aradı, sonrasında ofisten giden temas yok. */
  awaitingReply: { sinceAt: string; days: number } | null;
  /** Kayıt açılışından ilk gerçek temasa süre (çalışma dakikası); ölçülemezse null. */
  firstResponse: LeadResponse | null;
  suggestions: IntelSuggestion[];
};

const NON_TOUCH = new Set(["note"]);

function isOutboundTouch(t: IntelTouch): boolean {
  if (t.direction !== "outbound") return false;
  return t.channel === "call" || TOUCH_CHANNELS.includes(t.channel);
}

export function buildCustomerIntel(input: CustomerIntelInput, nowMs: number): CustomerIntel {
  const valid = input.touches.filter((t) => !NON_TOUCH.has(t.channel) && !Number.isNaN(Date.parse(t.at)));
  const inboundList = valid.filter((t) => t.direction === "inbound" || t.missed);
  const outboundList = valid.filter((t) => isOutboundTouch(t) && !t.missed);
  const latest = (list: readonly IntelTouch[]) =>
    list.reduce<string | null>((best, t) => (best === null || Date.parse(t.at) > Date.parse(best) ? t.at : best), null);
  const lastInboundAt = latest(inboundList);
  const lastOutboundAt = latest(outboundList);
  const since30 = nowMs - 30 * DAY_MS;
  const last30 = {
    inbound: inboundList.filter((t) => Date.parse(t.at) >= since30).length,
    outbound: outboundList.filter((t) => Date.parse(t.at) >= since30).length,
  };

  const awaitingReply =
    lastInboundAt && (!lastOutboundAt || Date.parse(lastInboundAt) > Date.parse(lastOutboundAt))
      ? { sinceAt: lastInboundAt, days: Math.max(0, Math.floor((nowMs - Date.parse(lastInboundAt)) / DAY_MS)) }
      : null;

  const lastTouchAt = latest(valid);
  const sig = input.heatSignals;
  const heatInputs: CustomerHeatInputs = {
    lastContactAt: sig ? sig.last_contact : lastTouchAt,
    openDemands: sig ? sig.open_demands : input.openDemands,
    urgentDemands: sig ? sig.urgent_demands : 0,
    portalLikes30d: sig ? sig.portal_likes_30d : 0,
    hasOpenOfferOrDeal: sig ? sig.open_offers > 0 || sig.open_deals > 0 : input.hasOpenOfferOrDeal,
    createdAt: input.createdAt,
    blacklist: input.blacklist,
  };
  const heat = input.heat ?? scoreCustomerHeat(heatInputs, nowMs);

  const firstResponse = measureLead(
    { customerId: input.customerId, name: "", assignedTo: null, createdAt: input.createdAt },
    outboundList.map((t) => ({ at: t.at, kind: t.channel === "call" ? ("call" as const) : ("comm" as const) })),
    DEFAULT_SLA_MIN,
    nowMs,
  );

  const suggestions: IntelSuggestion[] = [];
  const inboxHref = `/app/gelen-kutusu?customer=${input.customerId}`;
  if (!input.blacklist) {
    if (awaitingReply) {
      suggestions.push({
        key: "yanit_bekleyen",
        title: "Yanıt bekleyen mesaj var",
        reason:
          awaitingReply.days === 0
            ? "Müşteri bugün yazdı/aradı; sonrasında ofisten giden temas kaydı yok."
            : `Müşteri ${awaitingReply.days} gün önce yazdı/aradı; sonrasında ofisten giden temas kaydı yok.`,
        href: inboxHref,
        cta: "Gelen kutusunda aç",
      });
    }
    if (!lastOutboundAt && firstResponse && !firstResponse.responded && firstResponse.status === "bekliyor_gec") {
      suggestions.push({
        key: "temas_yok",
        title: "Kayıt açıldı, henüz temas edilmedi",
        reason: "Kayıttan beri ofisten giden çağrı/mesaj kaydı yok; hedef süre (çalışma saati) aşıldı.",
        href: inboxHref,
        cta: "İletişim geçmişi",
      });
    }
    if ((heat.segment === "sicak" || heat.segment === "ilgili") && heatInputs.openDemands === 0 && !heatInputs.hasOpenOfferOrDeal) {
      suggestions.push({
        key: "talep_ac",
        title: "Canlı müşteri, açık talebi yok",
        reason: `Isı ${heat.score}/100 (${heat.label}) ama açık talep ve teklif/anlaşma yok; ne aradığını kayda geçirin.`,
        href: `/app/talepler/yeni?musteri=${input.customerId}`,
        cta: "Talep oluştur",
      });
    }
    if (heat.segment === "uykuda") {
      suggestions.push({
        key: "uykuda",
        title: "Uykuda müşteri",
        reason: `${heat.daysSinceContact ?? "—"} gündür temassız ve ısı düşük; yeniden iletişim planlayın.`,
        href: "/app/akilli-listeler",
        cta: "Akıllı listeler",
      });
    }
  }

  return {
    heat,
    heatApproximate: input.heat ? false : sig === null,
    last30,
    lastInboundAt,
    lastOutboundAt,
    awaitingReply,
    firstResponse,
    suggestions: suggestions.slice(0, 3),
  };
}
