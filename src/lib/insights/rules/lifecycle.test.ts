import { describe, expect, it } from "vitest";
import { anniversaryKey, evaluateLifecycle, LIFECYCLE_RULE_ID } from "./lifecycle";

// 2026-10-07 12:00 TR
const NOW = Date.parse("2026-10-07T09:00:00Z");

describe("lifecycle içgörü kuralı", () => {
  it("alımın 3. yılı ±15 gün: kanıtlı, href'li, kişi bazlı", () => {
    const out = evaluateLifecycle(
      {
        resale: [
          { dealId: "d1", customerId: "c1", customerName: "Ali Veli", propertyLabel: "Moda 2+1", assignedTo: "u1", closedAt: "2023-10-15T10:00:00Z", closedAtSource: "commission" },
          { dealId: "d2", customerId: "c2", customerName: "Ayşe", propertyLabel: null, assignedTo: "u1", closedAt: "2024-10-07T10:00:00Z", closedAtSource: "deal_update" },
        ],
        leaseEnd: [],
        sellers: [],
      },
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ruleId: LIFECYCLE_RULE_ID, kind: "match_suggestion", href: "/app/musteriler/c1", audience: { type: "user", userId: "u1" } });
    expect(out[0].title).toBe("Alımının 3. yılı: Ali Veli");
    expect(out[0].evidence.find((e) => e.label === "Kaynak")?.value).toBe("ilk komisyon kaydı");
    expect(out[0].href.startsWith("/")).toBe(true);
  });

  it("kira bitişine 0-90 gün: çapraz satış önerisi; geçmiş veya 90+ gün yok", () => {
    const out = evaluateLifecycle(
      {
        resale: [],
        leaseEnd: [
          { rentalId: "r1", renterName: "Kiracı A", propertyLabel: "Daire", assignedTo: "u2", endDate: "2026-11-01", hasOpenBuyDemand: false },
          { rentalId: "r2", renterName: "Kiracı B", propertyLabel: null, assignedTo: "u2", endDate: "2027-03-01", hasOpenBuyDemand: false },
          { rentalId: "r3", renterName: "Kiracı C", propertyLabel: null, assignedTo: "u2", endDate: "2026-09-01", hasOpenBuyDemand: false },
        ],
        sellers: [],
      },
      NOW,
    );
    expect(out.map((d) => d.entityId)).toEqual(["r1"]);
    expect(out[0].severity).toBe("orta");
    expect(out[0].href).toBe("/app/kiralama/r1");
  });

  it("evini satan malik: açık arayışı varsa veya 60 günden eskiyse içgörü yok", () => {
    const base = { customerName: "Malik", propertyLabel: "Villa", assignedTo: "u3" };
    const out = evaluateLifecycle(
      {
        resale: [],
        leaseEnd: [],
        sellers: [
          { ...base, customerId: "m1", soldAt: "2026-09-20T10:00:00Z", hasOpenDemand: false },
          { ...base, customerId: "m2", soldAt: "2026-09-20T10:00:00Z", hasOpenDemand: true },
          { ...base, customerId: "m3", soldAt: "2026-06-01T10:00:00Z", hasOpenDemand: false },
        ],
      },
      NOW,
    );
    expect(out.map((d) => d.entityId)).toEqual(["m1"]);
  });

  it("yıldönümü 29 Şubat → 28 Şubat; atanmamış kayıt içgörü üretmez", () => {
    expect(anniversaryKey("2024-02-29T10:00:00Z", 3)).toBe("2027-02-28");
    const out = evaluateLifecycle(
      { resale: [{ dealId: "d", customerId: "c", customerName: null, propertyLabel: null, assignedTo: "", closedAt: "2023-10-07", closedAtSource: "commission" }], leaseEnd: [], sellers: [] },
      NOW,
    );
    expect(out).toHaveLength(0);
  });
});
