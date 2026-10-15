import { describe, expect, it } from "vitest";
import {
  advisorNoticeText,
  anniversaryNoteFor,
  excludeBuyer,
  groupAdvisorNotices,
  normalizeDealType,
  pickDemandsToClose,
  postCloseMessage,
  propertyLabel,
} from "./post-close-model";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("pickDemandsToClose", () => {
  const rows = [
    { id: "d1", status: "active", transaction_type: "sale", property_type: "apartment" },
    { id: "d2", status: "new", transaction_type: "sale", property_type: null },
    { id: "d3", status: "matched", transaction_type: "rent", property_type: "apartment" },
    { id: "d4", status: "closed", transaction_type: "sale", property_type: "apartment" },
    { id: "d5", status: "active", transaction_type: "sale", property_type: "shop" },
  ];

  it("açık + aynı işlem türü + uyumlu tip kapanır; önceki durum saklanır", () => {
    expect(pickDemandsToClose(rows, "sale", "apartment")).toEqual([
      { id: "d1", previousStatus: "active" },
      { id: "d2", previousStatus: "new" },
    ]);
  });

  it("portföy tipi bilinmiyorsa tip süzgeci uygulanmaz", () => {
    expect(pickDemandsToClose(rows, "sale", null).map((d) => d.id)).toEqual(["d1", "d2", "d5"]);
  });

  it("kiralamada yalnız kiralık talepler", () => {
    expect(pickDemandsToClose(rows, "rent", "apartment")).toEqual([{ id: "d3", previousStatus: "matched" }]);
  });
});

describe("yardımcılar", () => {
  it("yıldönümü notu ve işlem türü", () => {
    expect(anniversaryNoteFor("sale")).toBe("Satın alma");
    expect(anniversaryNoteFor("rent")).toBe("Kiralama");
    expect(normalizeDealType("rent")).toBe("rent");
    expect(normalizeDealType("x")).toBe("sale");
  });

  it("alıcının kendi kayıtları dışarıda kalır", () => {
    const rows = [{ id: "1", customer_id: "buyer" }, { id: "2", customer_id: "other" }, { id: "3", customer_id: null }];
    expect(excludeBuyer(rows, "buyer").map((r) => r.id)).toEqual(["2", "3"]);
    expect(excludeBuyer(rows, null)).toHaveLength(3);
  });

  it("portföy etiketi", () => {
    expect(propertyLabel({ property_code: "P-1", title: "Daire" })).toBe("P-1 · Daire");
    expect(propertyLabel({ property_code: null, title: "Daire" })).toBe("Daire");
    expect(propertyLabel(null)).toBe("Portföy");
  });
});

describe("groupAdvisorNotices", () => {
  it("sorumlu (yoksa oluşturan) danışman başına toplar, işlemi yapanı atlar", () => {
    const notices = groupAdvisorNotices(
      [
        { id: "a1", customer_id: null, assigned_to: "u2", created_by: "u1" },
        { id: "a2", customer_id: null, assigned_to: null, created_by: "u3" },
        { id: "a3", customer_id: null, assigned_to: "u1", created_by: "u2" },
      ],
      [
        { id: "o1", customer_id: null, created_by: "u2" },
        { id: "o2", customer_id: null, created_by: "u1" },
      ],
      "u1",
    );
    expect(notices).toEqual([
      { userId: "u2", appointmentIds: ["a1"], offerIds: ["o1"] },
      { userId: "u3", appointmentIds: ["a2"], offerIds: [] },
    ]);
  });
});

describe("advisorNoticeText", () => {
  it("tek randevu kaydın kendisine, tek teklif teklif sayfasına, karışık portföye gider", () => {
    expect(advisorNoticeText({ userId: "u", appointmentIds: [A], offerIds: [] }, "P-1", "sale", "p1").href).toBe(`/app/randevular?randevu=${A}`);
    expect(advisorNoticeText({ userId: "u", appointmentIds: [], offerIds: [B] }, "P-1", "sale", "p1").href).toBe(`/app/teklifler/${B}`);
    const mixed = advisorNoticeText({ userId: "u", appointmentIds: [A], offerIds: [B] }, "P-1", "rent", "p1");
    expect(mixed.href).toBe("/app/portfoyler/p1");
    expect(mixed.title).toBe("Portföy kiralandı: P-1");
    expect(mixed.body).toContain("1 yaklaşan randevunuz ve 1 bekleyen teklifiniz");
  });
});

describe("postCloseMessage", () => {
  it("değişiklik ve bekleyenleri tek metinde söyler", () => {
    expect(
      postCloseMessage({
        closedDemands: [{ id: "d1", previousStatus: "active" }],
        anniversary: { customerId: "c", date: "2026-10-15", note: "Satın alma" },
        appointmentIds: ["a"],
        offerIds: [],
      }),
    ).toBe(
      "1 açık talep kapatıldı, müşterinin yıldönümü 2026-10-15 (Satın alma) olarak kaydedildi. Portföyde hâlâ 1 yaklaşan randevu var; sorumlu diğer danışmanlara bildirim gönderilir.",
    );
  });

  it("hiçbir şey yoksa null", () => {
    expect(postCloseMessage({ closedDemands: [], anniversary: null, appointmentIds: [], offerIds: [] })).toBeNull();
  });
});
