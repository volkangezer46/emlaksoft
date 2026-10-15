import { describe, expect, it } from "vitest";
import { commissionPayoutState, parsePayoutPayInput, payoutPaidEvent, planPayouts, type ExistingPayout, type PayoutSplit } from "./commission-payouts";
import { isPostingKey } from "./posting/keys";

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

describe("hakediş ödemesi girdisi ve defter olayı (WP3)", () => {
  const ACC = "11111111-1111-4111-8111-111111111111";
  const PID = "b0000000-0000-4000-8000-000000000001";

  it("girdi: hesap zorunlu, stopaj 0–40, tarih gelecekte olamaz, boş tarih bugün", () => {
    expect(parsePayoutPayInput({ accountId: "" }, "2026-10-15")).toMatchObject({ ok: false });
    expect(parsePayoutPayInput({ accountId: ACC, withholdingRate: -1 }, "2026-10-15")).toMatchObject({ ok: false });
    expect(parsePayoutPayInput({ accountId: ACC, withholdingRate: 41 }, "2026-10-15")).toMatchObject({ ok: false });
    expect(parsePayoutPayInput({ accountId: ACC, date: "2026-10-16" }, "2026-10-15")).toMatchObject({ ok: false });
    expect(parsePayoutPayInput({ accountId: ACC, paymentRef: "x".repeat(201) }, "2026-10-15")).toMatchObject({ ok: false });
    expect(parsePayoutPayInput({ accountId: ACC.toUpperCase(), withholdingRate: null, paymentRef: " EFT " }, "2026-10-15")).toEqual({
      ok: true,
      value: { accountId: ACC, withholdingRate: 0, paymentRef: "EFT", date: "2026-10-15" },
    });
  });

  it("stopajlı: nakit net + stopaj (brüt), stopaj vergi dairesine borç (muhtasar günü vadeli), anahtar payout:{id}", () => {
    const { event, net, withheld } = payoutPaidEvent({
      payoutId: PID, accountId: ACC, amount: 1000.01, withholdingRate: 20, date: "2026-10-15", advisorName: "Ayşe", splitItemId: "item-1",
    });
    expect(withheld).toBe(200);
    expect(net).toBe(800.01);
    expect(net + withheld).toBeCloseTo(1000.01, 2);
    expect(isPostingKey(event.postingKey, "payout.paid")).toBe(true);
    expect(event).toMatchObject({
      eventType: "payout.paid",
      postingKey: `payout:${PID}`,
      sourceId: PID,
      entries: [{ accountId: ACC, amount: 800.01, withholdingAmount: 200, settles: "item-1", counterparty: "Ayşe" }],
      item: { amount: 200, dueDate: "2026-11-26" },
    });
  });

  it("stopajsız: açık kalem yok, nakit = brüt", () => {
    const { event, net, withheld } = payoutPaidEvent({ payoutId: PID, accountId: ACC, amount: 500, withholdingRate: 0, date: "2026-10-15" });
    expect([net, withheld]).toEqual([500, 0]);
    expect(event.item).toBeUndefined();
    expect(event.entries).toEqual([{ accountId: ACC, amount: 500, title: "Hakediş ödemesi" }]);
  });
});
