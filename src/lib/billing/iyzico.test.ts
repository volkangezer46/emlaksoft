import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutRetrieveResponseSignature,
  createIyzicoAuthorization,
  createWebhookSignatureV3,
  getIyzicoConfig,
  normalizeIyzicoBaseUrl,
  normalizeIyzicoBuyerIp,
  retrieveCheckoutForm,
  verifyCheckoutPayment,
  verifyCheckoutRetrieveResponseSignature,
  verifyWebhookSignatureV3,
} from "./iyzico";

const secretKey = "merchant_secret_key";

describe("iyzico API origin allowlist", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [undefined, "https://sandbox-api.iyzipay.com"],
    ["https://sandbox-api.iyzipay.com/", "https://sandbox-api.iyzipay.com"],
    ["HTTPS://API.IYZIPAY.COM", "https://api.iyzipay.com"],
  ])("accepts only an exact official origin (%s)", (configured, expected) => {
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", secretKey);
    vi.stubEnv("IYZICO_BASE_URL", configured ?? "");

    expect(normalizeIyzicoBaseUrl(configured)).toBe(expected);
    expect(getIyzicoConfig()?.baseUrl).toBe(expected);
  });

  it.each([
    "http://api.iyzipay.com",
    "https://attacker.example",
    "https://api.iyzipay.com.attacker.example",
    "https://api.iyzipay.com/payment",
    "https://user:password@api.iyzipay.com",
    "https://api.iyzipay.com?redirect=attacker",
    "not-a-url",
  ])("fails closed for an untrusted credential destination (%s)", (configured) => {
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", secretKey);
    vi.stubEnv("IYZICO_BASE_URL", configured);

    expect(normalizeIyzicoBaseUrl(configured)).toBeNull();
    expect(getIyzicoConfig()).toBeNull();
  });
});

describe("iyzico IYZWSv2 request authorization", () => {
  it("matches the official randomKey + path + body canonical formula", () => {
    const body = '{"locale":"tr","conversationId":"fixture-1","price":"100.00"}';
    const authorization = createIyzicoAuthorization(
      { apiKey: "apiKey", secretKey: "secretKey" },
      "/payment/iyzipos/checkoutform/initialize/auth/ecom",
      body,
      "123456789",
    );

    expect(authorization.signature).toBe(
      "e2516448d6ae1db34f36f321e3407a1fbd24acdda94b2081c5f442398db6f08d",
    );
    expect(authorization.authorization).toBe(
      "IYZWSv2 YXBpS2V5OmFwaUtleSZyYW5kb21LZXk6MTIzNDU2Nzg5JnNpZ25hdHVyZTplMjUxNjQ0OGQ2YWUxZGIzNGYzNmYzMjFlMzQwN2ExZmJkMjRhY2RkYTk0YjIwODFjNWY0NDIzOThkYjZmMDhk",
    );
  });

  it("changes the digest when only the request path changes", () => {
    const common = { apiKey: "apiKey", secretKey: "secretKey" };
    const body = '{"locale":"tr"}';
    expect(createIyzicoAuthorization(common, "/path-a", body, "rnd").signature)
      .not.toBe(createIyzicoAuthorization(common, "/path-b", body, "rnd").signature);
  });
});

// Payload values are the Direct/HPP examples published in iyzico's V3 webhook
// documentation. Expected digests are fixed fixtures, not calculated in tests.
const direct = {
  format: "direct" as const,
  iyziEventType: "API_AUTH",
  paymentId: "28157248",
  paymentConversationId: "conversationId",
  status: "SUCCESS",
};
const hpp = {
  format: "hpp" as const,
  iyziEventType: "CHECKOUT_FORM_AUTH",
  iyziPaymentId: "28157797",
  token: "9895e0e6-cd7e-4635-9c33-fe52c337de09", // gitleaks:allow -- public provider fixture
  paymentConversationId: "123456789",
  status: "SUCCESS",
};

describe("iyzico X-IYZ-SIGNATURE-V3", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("matches the official Direct canonical field order fixture", () => {
    expect(createWebhookSignatureV3(secretKey, direct)).toBe(
      "0e071b3d0d41f0804527c8badc185d70e3485f64bf4b1af65fb7e8f05042d10d",
    );
  });

  it("matches the official HPP canonical field order fixture", () => {
    expect(createWebhookSignatureV3(secretKey, hpp)).toBe(
      "61346bd22017db0de3cd452937fd380b55b30c066df66526fb1bfcc29b07155e",
    );
  });

  it("fails closed when a required canonical field is absent", () => {
    expect(createWebhookSignatureV3(secretKey, { ...hpp, token: "" })).toBeNull();
  });

  it("accepts only the configured-secret digest and compares valid hex bytes", () => {
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", secretKey);
    const signature = "61346bd22017db0de3cd452937fd380b55b30c066df66526fb1bfcc29b07155e";

    expect(verifyWebhookSignatureV3(signature.toUpperCase(), hpp)).toBe(true);
    expect(verifyWebhookSignatureV3("0".repeat(64), hpp)).toBe(false);
    expect(verifyWebhookSignatureV3("not-hex", hpp)).toBe(false);
  });
});

describe("iyzico Checkout Form response verification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const retrieve = {
    status: "success",
    paymentStatus: "SUCCESS",
    paymentId: "28157797",
    currency: "TRY",
    basketId: "basket-123",
    conversationId: "conversation-123",
    paidPrice: "12500.00",
    price: "12500.0",
    token: "token-123",
    fraudStatus: 1,
    signature: "b2999ee4fb1f3277c943de4e9e737e0e25ff85528dc0aacced8f384ccd346388",
  };

  it("matches the fixed Checkout Form retrieve HMAC fixture and trailing-zero rules", () => {
    expect(createCheckoutRetrieveResponseSignature(secretKey, retrieve)).toBe(retrieve.signature);
    expect(verifyCheckoutRetrieveResponseSignature(retrieve, secretKey)).toBe(true);
    expect(verifyCheckoutRetrieveResponseSignature({ ...retrieve, paidPrice: "12499.99" }, secretKey)).toBe(false);
  });

  it("fails the retrieve boundary closed when the response HMAC is absent or altered", async () => {
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", secretKey);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(retrieve), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(retrieveCheckoutForm("token-123")).resolves.toMatchObject({
      paymentId: "28157797",
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toBe(
      "https://sandbox-api.iyzipay.com/payment/iyzipos/checkoutform/auth/ecom/detail",
    );
    expect(requestInit).toMatchObject({ redirect: "error", cache: "no-store" });
    expect((requestInit as RequestInit).signal).toBeInstanceOf(AbortSignal);

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ ...retrieve, signature: "0".repeat(64) }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(retrieveCheckoutForm("token-123")).rejects.toThrow("yanıt imzası");
  });

  it("rejects an untrusted base URL before making a credential-bearing request", async () => {
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", secretKey);
    vi.stubEnv("IYZICO_BASE_URL", "https://api.iyzipay.com.attacker.example");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(retrieveCheckoutForm("token-123")).rejects.toThrow("yapılandırılmamış");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reconciles every fulfillment identity, amount and currency field", () => {
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", secretKey);
    expect(verifyCheckoutPayment(retrieve, {
      conversationId: "conversation-123",
      basketId: "basket-123",
      amountTry: 12500,
      paymentId: "28157797",
      currency: "TRY",
    })).toMatchObject({ paymentId: "28157797", amountTry: 12500, currency: "TRY" });

    const eur = { ...retrieve, currency: "EUR" };
    eur.signature = createCheckoutRetrieveResponseSignature(secretKey, eur)!;
    expect(() => verifyCheckoutPayment(eur, {
      conversationId: "conversation-123",
      basketId: "basket-123",
      amountTry: 12500,
      currency: "TRY",
    })).toThrow("para birimi");
    const wrongPrice = { ...retrieve, price: 1 };
    wrongPrice.signature = createCheckoutRetrieveResponseSignature(secretKey, wrongPrice)!;
    expect(() => verifyCheckoutPayment(wrongPrice, {
      conversationId: "conversation-123",
      basketId: "basket-123",
      amountTry: 12500,
      currency: "TRY",
    })).toThrow("tahsilat tutarı");
  });

  it.each([
    [0, "review"],
    [-1, "rejected"],
    [undefined, "missing"],
  ])("fails fulfillment closed for fraudStatus=%s (%s)", (fraudStatus, _label) => {
    vi.stubEnv("IYZICO_API_KEY", "sandbox-api-key");
    vi.stubEnv("IYZICO_SECRET_KEY", secretKey);
    expect(() => verifyCheckoutPayment({ ...retrieve, fraudStatus }, {
      conversationId: "conversation-123",
      basketId: "basket-123",
      amountTry: 12500,
      paymentId: "28157797",
      currency: "TRY",
    })).toThrow("sahtecilik");
  });

  it("normalizes only syntactically valid IPv4/IPv6 buyer addresses", () => {
    expect(normalizeIyzicoBuyerIp(" 203.0.113.9 ")).toBe("203.0.113.9");
    expect(normalizeIyzicoBuyerIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIyzicoBuyerIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIyzicoBuyerIp("unknown")).toBeNull();
    expect(normalizeIyzicoBuyerIp("203.0.113.9, 10.0.0.1")).toBeNull();
  });
});
