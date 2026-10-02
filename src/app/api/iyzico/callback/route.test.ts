import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const configured = vi.fn();
const retrieve = vi.fn();
vi.mock("@/lib/billing/iyzico", () => ({
  IYZICO_CURRENCY: "TRY",
  isIyzicoConfigured: () => configured(),
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
vi.mock("@/lib/base-url", () => ({ getBaseUrl: () => "https://example.test" }));

import { GET, POST } from "./route";

function loc(res: Response) {
  return res.headers.get("location");
}

describe("iyzico callback", () => {
  beforeEach(() => {
    configured.mockReset();
    retrieve.mockReset();
  });

  it("token yoksa hata sayfasına yönlendirir", async () => {
    const res = await GET(new NextRequest("http://localhost/api/iyzico/callback"));
    expect(loc(res)).toBe("https://example.test/app/abonelik?error=token");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("POST gövdesiz/bozuk form: token yok yönlendirmesi", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/iyzico/callback", { method: "POST", body: "garbage" }),
    );
    expect(loc(res)).toBe("https://example.test/app/abonelik?error=token");
  });

  it("yapılandırma yoksa sağlayıcıya gidilmez", async () => {
    configured.mockReturnValue(false);
    const res = await GET(new NextRequest("http://localhost/api/iyzico/callback?token=t"));
    expect(loc(res)).toBe("https://example.test/app/abonelik?error=config");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("ödeme başarısızsa error=payment", async () => {
    configured.mockReturnValue(true);
    retrieve.mockResolvedValue({
      status: "failure",
      paymentStatus: "FAILURE",
      conversationId: "c1",
    });
    const res = await GET(new NextRequest("http://localhost/api/iyzico/callback?token=t"));
    expect(loc(res)).toBe("https://example.test/app/abonelik?error=payment");
  });

  it("sağlayıcı hatasında callback hatasına düşer", async () => {
    configured.mockReturnValue(true);
    retrieve.mockRejectedValue(new Error("ağ"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new NextRequest("http://localhost/api/iyzico/callback?token=t"));
    expect(loc(res)).toBe("https://example.test/app/abonelik?error=callback");
  });
});
