import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));
vi.mock("@/lib/platform-settings", () => ({ getPlatformSetting: vi.fn().mockResolvedValue(null) }));
const getPlanDefinition = vi.fn();
vi.mock("@/lib/billing/plan-definitions", () => ({ getPlanDefinition: (id: string) => getPlanDefinition(id) }));

import { chargeAiUsage, countValuationReport, resetMeterCaches } from "./meter";

beforeEach(() => {
  resetMeterCaches();
  rpc.mockReset();
  maybeSingle.mockReset().mockResolvedValue({ data: { plan: "office" } });
  getPlanDefinition.mockReset().mockResolvedValue({ aiCreditsMonthly: 500, valuationReportsMonthly: 10 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("kredi olcumu", () => {
  it("kullanimi RPC ile yazar: kota, jeton ve kredi, ham istem YOK", async () => {
    rpc.mockResolvedValue({ data: { balance: 497.5 }, error: null });
    const r = await chargeAiUsage({ tenantId: "t1", actorId: "u1", feature: "tenant_chat", model: "gpt-4o-mini", tokensIn: 1000, tokensOut: 1000 });
    expect(r).toMatchObject({ metered: true, balance: 497.5, credits: 0.75 });
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("ai_credit_charge");
    expect(args).toMatchObject({ p_tenant_id: "t1", p_unit: "ai", p_amount: 0.75, p_quota: 500, p_feature: "tenant_chat", p_tokens_in: 1000 });
    expect(Object.keys(args as object).some((k) => /prompt|content|message/i.test(k))).toBe(false);
  });

  it("plan kotasi bos ise SINIRSIZ: p_quota null gonderilir", async () => {
    getPlanDefinition.mockResolvedValue({});
    rpc.mockResolvedValue({ data: { balance: null, unlimited: true }, error: null });
    const r = await chargeAiUsage({ tenantId: "t1", feature: "x", model: "m", tokensIn: 10, tokensOut: 10 });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_quota: null });
    expect(r).toMatchObject({ metered: true, balance: null });
  });

  it("asimda cagri engellenmez: negatif bakiye ile basarili doner", async () => {
    rpc.mockResolvedValue({ data: { balance: -12 }, error: null });
    const r = await chargeAiUsage({ tenantId: "t1", feature: "x", model: "m", tokensIn: 10, tokensOut: 10 });
    expect(r.metered).toBe(true);
    expect(r.balance).toBe(-12);
  });

  it("FAIL-OPEN: RPC hatasi / fırlatma sessizce metered:false", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await chargeAiUsage({ tenantId: "t1", feature: "x", model: "m", tokensIn: 1, tokensOut: 1 })).metered).toBe(false);
    rpc.mockRejectedValueOnce(new Error("ag"));
    await expect(chargeAiUsage({ tenantId: "t1", feature: "x", model: "m", tokensIn: 1, tokensOut: 1 })).resolves.toMatchObject({ metered: false });
  });

  it("tablo/RPC yokken olcum etkin degil ve bir sure tekrar denenmez", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const a = await chargeAiUsage({ tenantId: "t1", feature: "x", model: "m", tokensIn: 1, tokensOut: 1 });
    const b = await chargeAiUsage({ tenantId: "t1", feature: "x", model: "m", tokensIn: 1, tokensOut: 1 });
    expect(a.metered).toBe(false);
    expect(b.metered).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("tenant yoksa hicbir sey yazilmaz", async () => {
    expect((await chargeAiUsage({ tenantId: "", feature: "x", model: "m", tokensIn: 1, tokensOut: 1 })).metered).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("degerleme raporu: birim valuation, rapor kimligiyle idempotent, kota plandan", async () => {
    rpc.mockResolvedValue({ data: { balance: 9 }, error: null });
    await countValuationReport({ tenantId: "t1", actorId: "u1", valuationId: "v1" });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_unit: "valuation", p_amount: 1, p_quota: 10, p_idempotency_key: "valuation:v1" });
  });
});
