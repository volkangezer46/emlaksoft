import { describe, expect, it } from "vitest";
import { buildCustomerIntel, type CustomerIntelInput } from "./summary";

const NOW = Date.UTC(2026, 2, 10, 9, 0); // Salı 12:00 TR
const day = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const base: CustomerIntelInput = {
  customerId: "c1",
  createdAt: iso(NOW - 40 * day),
  blacklist: false,
  touches: [],
  openDemands: 0,
  hasOpenOfferOrDeal: false,
  heatSignals: null,
};

describe("buildCustomerIntel", () => {
  it("not kaydı temas sayılmaz", () => {
    const r = buildCustomerIntel({ ...base, touches: [{ at: iso(NOW - day), direction: "outbound", channel: "note" }] }, NOW);
    expect(r.lastOutboundAt).toBeNull();
    expect(r.last30).toEqual({ inbound: 0, outbound: 0 });
  });

  it("gelen mesaj sonrası giden yoksa yanıt bekleyen önerisi", () => {
    const r = buildCustomerIntel(
      {
        ...base,
        touches: [
          { at: iso(NOW - 5 * day), direction: "outbound", channel: "whatsapp" },
          { at: iso(NOW - 2 * day), direction: "inbound", channel: "whatsapp" },
        ],
      },
      NOW,
    );
    expect(r.awaitingReply?.days).toBe(2);
    expect(r.suggestions[0]).toMatchObject({ key: "yanit_bekleyen", href: "/app/gelen-kutusu?customer=c1" });
  });

  it("giden temas sonrası bekleyen yok", () => {
    const r = buildCustomerIntel(
      {
        ...base,
        touches: [
          { at: iso(NOW - 3 * day), direction: "inbound", channel: "sms" },
          { at: iso(NOW - 2 * day), direction: "outbound", channel: "call" },
        ],
      },
      NOW,
    );
    expect(r.awaitingReply).toBeNull();
  });

  it("cevapsız çağrı gelen sayılır, giden sayılmaz", () => {
    const r = buildCustomerIntel(
      { ...base, touches: [{ at: iso(NOW - day), direction: "outbound", channel: "call", missed: true }] },
      NOW,
    );
    expect(r.awaitingReply).not.toBeNull();
    expect(r.lastOutboundAt).toBeNull();
  });

  it("hiç temas edilmemiş eski kayıt: temas_yok önerisi", () => {
    const r = buildCustomerIntel(base, NOW);
    expect(r.firstResponse?.status).toBe("bekliyor_gec");
    expect(r.suggestions.map((s) => s.key)).toContain("temas_yok");
  });

  it("kara listede öneri yok", () => {
    const r = buildCustomerIntel({ ...base, blacklist: true }, NOW);
    expect(r.suggestions).toEqual([]);
    expect(r.heat.score).toBe(0);
  });

  it("sıcak ama talepsiz müşteri: talep_ac; ısı RPC yoksa yaklaşık işareti", () => {
    const r = buildCustomerIntel(
      {
        ...base,
        createdAt: iso(NOW - 3 * day),
        heatSignals: { last_contact: iso(NOW - day), open_demands: 0, urgent_demands: 0, portal_likes_30d: 2, open_offers: 1, open_deals: 0 },
        hasOpenOfferOrDeal: false,
      },
      NOW,
    );
    // açık teklif var → talep_ac önerilmez
    expect(r.suggestions.map((s) => s.key)).not.toContain("talep_ac");
    expect(r.heatApproximate).toBe(false);
    const approx = buildCustomerIntel(base, NOW);
    expect(approx.heatApproximate).toBe(true);
  });
});
