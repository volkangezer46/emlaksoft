import { describe, expect, it } from "vitest";
import { computeNextBestActions, daysUntilAnnual, type NextBestActionInput } from "./next-best-action";
import { EMPTY_CONTACT_PREFS } from "@/lib/customer-contact-prefs";

// 2026-10-15 Perşembe 11:00 İstanbul (08:00 UTC)
const NOW = Date.UTC(2026, 9, 15, 8, 0, 0);
const H = 3_600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();

function input(over: Partial<NextBestActionInput> = {}): NextBestActionInput {
  return {
    customerId: "c1",
    firstName: "Ayşe",
    leadTier: "warm",
    leadLabel: "İlgili",
    telHref: "tel:+905321112233",
    waHref: "https://wa.me/905321112233",
    waMessageHref: (m) => `https://wa.me/905321112233?text=${encodeURIComponent(m)}`,
    email: null,
    lastActivityAt: iso(NOW - 2 * D),
    createdAt: iso(NOW - 30 * D),
    hasAnyContact: true,
    openDemands: [],
    canMatch: true,
    submittedOfferId: null,
    pastAppointmentPending: false,
    birthDate: null,
    anniversaryDate: null,
    prefs: EMPTY_CONTACT_PREFS,
    signals: { matchCount: null, presentationViewedAt: null, pendingPortalRequests: 0 },
    nowMs: NOW,
    ...over,
  };
}

describe("computeNextBestActions (CRM-G2)", () => {
  it("yeni ve hiç temas edilmemiş başvuru: ilk sırada 'ilk teması kurun' + Ara/WhatsApp", () => {
    const [a] = computeNextBestActions(input({ createdAt: iso(NOW - 3 * H), lastActivityAt: null, hasAnyContact: false }));
    expect(a.key).toBe("first_contact");
    expect(a.primary.kind).toBe("call");
    expect(a.secondary?.kind).toBe("whatsapp");
    expect(a.reason).toContain("3 saat önce");
  });

  it("48 saati geçen ya da temas edilmiş kayıtta hızlı dönüş kuralı tetiklenmez", () => {
    expect(computeNextBestActions(input({ createdAt: iso(NOW - 50 * H), hasAnyContact: false })).map((a) => a.key)).not.toContain("first_contact");
    expect(computeNextBestActions(input({ createdAt: iso(NOW - 3 * H), hasAnyContact: true })).map((a) => a.key)).not.toContain("first_contact");
  });

  it("WhatsApp tercih eden müşteride birincil düğme WhatsApp olur", () => {
    const [a] = computeNextBestActions(
      input({ createdAt: iso(NOW - 3 * H), hasAnyContact: false, prefs: { channel: "whatsapp", windows: [], language: null } }),
    );
    expect(a.primary.kind).toBe("whatsapp");
    expect(a.secondary?.kind).toBe("call");
  });

  it("uygun saat penceresi dışındaysa not eklenir", () => {
    const [a] = computeNextBestActions(
      input({ createdAt: iso(NOW - 3 * H), hasAnyContact: false, prefs: { channel: null, windows: ["aksam"], language: null } }),
    );
    expect(a.timingNote).toContain("akşam");
  });

  it("son 24 saatte açılan sunum dijital ilgi önerisi üretir", () => {
    const [a] = computeNextBestActions(
      input({ signals: { matchCount: null, presentationViewedAt: iso(NOW - 2 * H), presentationTitle: "Kadıköy 3+1", pendingPortalRequests: 0 } }),
    );
    expect(a.key).toBe("digital_interest");
    expect(a.reason).toContain("Kadıköy 3+1");
  });

  it("eşleşme önerisi yalnız GERÇEK sayı > 0 iken ve en fazla iki öneri", () => {
    const base = { openDemands: [{ id: "d1", created_at: iso(NOW - 5 * D), label: "daire satılık" }] };
    expect(computeNextBestActions(input({ ...base })).map((a) => a.key)).not.toContain("match");
    expect(computeNextBestActions(input({ ...base, signals: { matchCount: 0, presentationViewedAt: null, pendingPortalRequests: 0 } })).map((a) => a.key)).not.toContain("match");
    const out = computeNextBestActions(
      input({ ...base, submittedOfferId: "o1", pastAppointmentPending: true, signals: { matchCount: 4, presentationViewedAt: null, pendingPortalRequests: 0 } }),
    );
    expect(out).toHaveLength(2);
    expect(out[0].key).toBe("match");
    expect(out[0].title).toContain("4 uygun portföy");
    expect(out[1].key).toBe("offer");
  });

  it("eşleşme yetkisi yoksa eşleşme önerisi çıkmaz", () => {
    const out = computeNextBestActions(
      input({ canMatch: false, openDemands: [{ id: "d1", created_at: iso(NOW), label: "" }], signals: { matchCount: 3, presentationViewedAt: null, pendingPortalRequests: 0 } }),
    );
    expect(out.map((a) => a.key)).not.toContain("match");
  });

  it("sıcak ve 14+ gün temassız müşteri için arama önerisi", () => {
    const [a] = computeNextBestActions(input({ leadTier: "hot", leadLabel: "Sıcak", lastActivityAt: iso(NOW - 20 * D) }));
    expect(a.key).toBe("call");
    expect(a.reason).toContain("20 gündür");
  });

  it("45+ günlük açık talep için WhatsApp teyit taslağı", () => {
    const [a] = computeNextBestActions(input({ openDemands: [{ id: "d1", created_at: iso(NOW - 60 * D), label: "daire satılık" }] }));
    expect(a.key).toBe("stale_demand");
    expect(a.primary.kind).toBe("whatsapp");
    expect(decodeURIComponent(a.primary.href)).toContain("daire satılık arayışınız");
  });

  it("doğum günü 3 gün içinde ise tebrik önerisi", () => {
    const [a] = computeNextBestActions(input({ birthDate: "1990-10-17" }));
    expect(a.key).toBe("occasion");
    expect(a.title).toBe("Doğum günü 2 gün sonra");
  });

  it("kural tutmazsa boş liste", () => {
    expect(computeNextBestActions(input())).toEqual([]);
  });
});

describe("daysUntilAnnual", () => {
  it("yıl dönümüne kalan gün (geçmişse gelecek yıl)", () => {
    expect(daysUntilAnnual("1980-10-15", NOW)).toBe(0);
    expect(daysUntilAnnual("1980-10-14", NOW)).toBe(364);
    expect(daysUntilAnnual(null, NOW)).toBeNull();
    expect(daysUntilAnnual("bozuk", NOW)).toBeNull();
  });
});
