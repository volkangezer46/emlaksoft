import { describe, expect, it } from "vitest";
import { commissionPayoutState, planPayouts, type ExistingPayout, type PayoutSplit } from "./commission-payouts";

const split = (id: string, amount: number, profile = "p1", commission = "c1"): PayoutSplit => ({ id, commission_id: commission, profile_id: profile, amount });
const payout = (id: string, splitId: string, status: string, approvedAt: string | null = null): ExistingPayout => ({ id, split_id: splitId, status, approved_at: approvedAt });

describe("hakediş planı", () => {
  it("hakedişi olmayan pay eklenir, bekleyen/onaylı yükseltilir, ödenmiş atlanır", () => {
    const plan = planPayouts(
      [split("s1", 100), split("s2", 200), split("s3", 300), split("s4", 400)],
      [payout("y2", "s2", "pending"), payout("y3", "s3", "approved", "2026-10-01T00:00:00Z"), payout("y4", "s4", "paid")],
    );
    expect(plan.inserts.map((s) => s.id)).toEqual(["s1"]);
    expect(plan.promotes).toEqual([
      { payoutId: "y2", approvedAt: null, split: split("s2", 200) },
      { payoutId: "y3", approvedAt: "2026-10-01T00:00:00Z", split: split("s3", 300) },
    ]);
    expect(plan.alreadyPaid.map((s) => s.id)).toEqual(["s4"]);
  });

  it("iptal edilmiş hakediş yok sayılır (pay yeniden ödenebilir); 0 tutarlı pay ödenmez", () => {
    const plan = planPayouts([split("s1", 100), split("s2", 0)], [payout("y1", "s1", "cancelled")]);
    expect(plan.inserts.map((s) => s.id)).toEqual(["s1"]);
    expect(plan.promotes).toEqual([]);
  });

  it("satır durumu: tahsil edilmemişte ödenebilir değil; tümü ödenmişse 'paid'", () => {
    expect(commissionPayoutState(true, [split("s1", 100), split("s2", 50)], [])).toEqual({ state: "payable", payableAmount: 150 });
    expect(commissionPayoutState(false, [split("s1", 100)], [])).toEqual({ state: "none", payableAmount: 0 });
    expect(commissionPayoutState(true, [split("s1", 100)], [payout("y1", "s1", "paid")])).toEqual({ state: "paid", payableAmount: 0 });
    expect(commissionPayoutState(true, [], [])).toEqual({ state: "none", payableAmount: 0 });
  });
});
