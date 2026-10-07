import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { potentialLossAmount, summarizeLosses } from "@/lib/listing-control/potential-loss-core";
import { PROPERTY_MANAGED_ANOMALY_TYPES } from "@/lib/listing-control/types";

const NOW = Date.UTC(2026, 9, 7, 9);
const MONTH = Date.UTC(2026, 8, 30, 21); // 1 Ekim 00:00 TR

describe("potansiyel kayıp tek kaynak", () => {
  it("closure_loss tutarı formdan; potential_lost_deal liste fiyatı × oran (Kayıp-Kaçak hesabı)", () => {
    expect(potentialLossAmount("closure_loss", { estimated_lost_commission: 60000 }, { listPrice: null, commissionRate: null })).toBe(60000);
    expect(potentialLossAmount("potential_lost_deal", {}, { listPrice: 5_000_000, commissionRate: 2 })).toBe(100000);
    expect(potentialLossAmount("potential_lost_deal", {}, { listPrice: null, commissionRate: 2 })).toBe(0);
  });

  it("özet: ay/tümü/8 hafta ve kaynak sayıları", () => {
    const s = summarizeLosses(
      [
        { id: "1", type: "closure_loss", at: new Date(NOW - 86_400_000).toISOString(), propertyId: "p", amount: 1000 },
        { id: "2", type: "potential_lost_deal", at: new Date(NOW - 20 * 86_400_000).toISOString(), propertyId: "p", amount: 500 },
      ],
      NOW,
      MONTH,
    );
    expect(s).toMatchObject({ month: 1000, all: 1500, closureCount: 1, portalCount: 1 });
    expect(s.weeks[7]).toBe(1000);
    expect(s.weeks.reduce((a, b) => a + b, 0)).toBe(1500);
  });

  it("closure_loss motorun eşitlediği türlerden değil (otomatik kapanmaz); ekran ve cron tek kaynağa bağlı", () => {
    expect(PROPERTY_MANAGED_ANOMALY_TYPES).not.toContain("closure_loss");
    const page = readFileSync("src/app/app/kayip-kacak/page.tsx", "utf8");
    expect(page).toContain("loadPotentialLosses(");
    expect(page).toContain("summarizeLosses(");
    expect(readFileSync("src/app/api/cron/leak-sla/route.ts", "utf8")).toContain("20261007000610");
  });
});
