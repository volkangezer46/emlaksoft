import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configured = vi.fn();
const verifySig = vi.fn();
const retrieve = vi.fn();
vi.mock("@/lib/billing/iyzico", () => ({
  IYZICO_CURRENCY: "TRY",
  isIyzicoConfigured: () => configured(),
  verifyWebhookSignatureV3: (...a: unknown[]) => verifySig(...a),
  retrieveCheckoutForm: (...a: unknown[]) => retrieve(...a),
  verifyCheckoutPayment: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("admin client bu testte çağrılmamalı");
  },
}));
vi.mock("@/lib/billing/fulfillment", () => ({
  fulfillSuccessfulPayment: vi.fn(),
  invoiceAmountsTry: vi.fn(),
}));
vi.mock("@/lib/billing/payment-link-fulfill", () => ({
  fulfillPaymentLinkByConversation: vi.fn(),
}));

import { POST } from "./route";

function post(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/iyzico/webhook", {
    method: "POST",
    body,
    headers,
  });
}

describe("iyzico webhook", () => {
  beforeEach(() => {
    configured.mockReset();
    verifySig.mockReset();
    retrieve.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("yapılandırma yoksa 503", async () => {
    configured.mockReturnValue(false);
    const res = await POST(post("{}"));
    expect(res.status).toBe(503);
    expect(verifySig).not.toHaveBeenCalled();
  });

  it("bozuk JSON 400", async () => {
    configured.mockReturnValue(true);
    const res = await POST(post("{nope"));
    expect(res.status).toBe(400);
    expect(verifySig).not.toHaveBeenCalled();
  });

  it("geçersiz imza 401 ve sağlayıcı sorgusu yapılmaz", async () => {
    configured.mockReturnValue(true);
    verifySig.mockReturnValue(false);
    const body = JSON.stringify({
      iyziEventType: "X",
      status: "SUCCESS",
      token: "t",
      paymentConversationId: "c",
    });
    const res = await POST(post(body, { "x-iyz-signature-v3": "bad" }));
    expect(res.status).toBe(401);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("imzalı ama SUCCESS olmayan olay yok sayılır", async () => {
    configured.mockReturnValue(true);
    verifySig.mockReturnValue(true);
    const res = await POST(
      post(JSON.stringify({ status: "FAILURE" }), { "x-iyz-signature-v3": "ok" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("imzalı direct (token'sız) SUCCESS yerelde ifa edilmez: 422", async () => {
    configured.mockReturnValue(true);
    verifySig.mockReturnValue(true);
    const body = JSON.stringify({
      status: "SUCCESS",
      paymentConversationId: "c1",
      paymentId: "p1",
    });
    const res = await POST(post(body, { "x-iyz-signature-v3": "ok" }));
    expect(res.status).toBe(422);
  });
});
