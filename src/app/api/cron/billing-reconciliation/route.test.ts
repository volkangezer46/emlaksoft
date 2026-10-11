import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  summary: { expiredCheckouts: 0, inspected: 0, fulfilled: 0, retryPending: 0, manualReview: 0, refundRequired: 0 },
  throws: false,
  heartbeat: [] as { status: string; detail?: string }[],
};

vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (_job: string, status: string, detail?: string) => {
    state.heartbeat.push({ status, detail });
    return true;
  },
}));
vi.mock("@/lib/billing/reconciliation", () => ({
  runBillingReconciliation: async () => {
    if (state.throws) throw new Error("boom");
    return state.summary;
  },
}));

import { GET } from "./route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/billing-reconciliation", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  state.summary = { expiredCheckouts: 0, inspected: 0, fulfilled: 0, retryPending: 0, manualReview: 0, refundRequired: 0 };
  state.throws = false;
  state.heartbeat = [];
});

describe("GET /api/cron/billing-reconciliation", () => {
  it("yetkisiz 401", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("refundRequired=0 -> ok", async () => {
    await GET(req("Bearer s3cret"));
    expect(state.heartbeat.at(-1)?.status).toBe("ok");
  });

  it("refundRequired=1 -> error, not iade gerekli der", async () => {
    state.summary.refundRequired = 1;
    const res = await GET(req("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(state.heartbeat.at(-1)?.status).toBe("error");
    expect(state.heartbeat.at(-1)?.detail).toContain("1 iade gerekli");
  });

  it("manualReview yalnız nota girer (ok kalır)", async () => {
    state.summary.manualReview = 2;
    await GET(req("Bearer s3cret"));
    expect(state.heartbeat.at(-1)?.status).toBe("ok");
    expect(state.heartbeat.at(-1)?.detail).toContain("2 elle inceleme");
  });

  it("istisna -> error + 500", async () => {
    state.throws = true;
    expect((await GET(req("Bearer s3cret"))).status).toBe(500);
    expect(state.heartbeat.at(-1)?.status).toBe("error");
  });
});
