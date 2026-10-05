import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_RENEW_MAX_ATTEMPTS,
  autoRenewAttemptAllowed,
  extractStoredCard,
  maskedCardLabel,
  parseAutoRenewFlag,
} from "./cards";
import {
  createPaymentAuthResponseSignature,
  verifyPaymentAuthResponseSignature,
  verifyStoredCardPayment,
  type StoredCardPaymentResult,
} from "./iyzico";

const secret = "merchant_secret_key";

describe("extractStoredCard", () => {
  const base = {
    status: "success",
    cardUserKey: "user-key-12345678",
    cardToken: "card-token-12345678",
    binNumber: "55287912",
    lastFourDigits: "1234",
    cardAssociation: "MASTER_CARD",
    cardFamily: "Bonus",
  };

  it("yalnız ilk 6 ve son 4 hane alınır", () => {
    const card = extractStoredCard(base);
    expect(card).toMatchObject({ binPrefix: "552879", lastFour: "1234", brand: "MASTER_CARD" });
    expect(JSON.stringify(card)).not.toContain("55287912");
  });

  it("eksik anahtar/hane varsa kaydetmez", () => {
    expect(extractStoredCard({ ...base, cardToken: undefined })).toBeNull();
    expect(extractStoredCard({ ...base, lastFourDigits: "12" })).toBeNull();
    expect(extractStoredCard({ ...base, binNumber: "123" })).toBeNull();
    expect(extractStoredCard({ ...base, cardUserKey: "kısa" })).toBeNull();
  });

  it("etiket maskelidir", () => {
    expect(maskedCardLabel({ brand: "VISA", bin_prefix: "411111", last_four: "9999" })).toBe("Visa · 4111 11•• •••• 9999");
  });
});

describe("otomatik yenileme kapıları", () => {
  it("bayrak yalnız 'true' ile açılır (varsayılan kapalı)", () => {
    expect(parseAutoRenewFlag(null)).toBe(false);
    expect(parseAutoRenewFlag("")).toBe(false);
    expect(parseAutoRenewFlag("1")).toBe(false);
    expect(parseAutoRenewFlag("on")).toBe(false);
    expect(parseAutoRenewFlag(" TRUE ")).toBe(true);
  });

  it("deneme sınırı ve aralık", () => {
    const nowMs = 10_000_000_000;
    expect(autoRenewAttemptAllowed({ priorAttempts: 0, lastAttemptAtMs: null, nowMs })).toBe(true);
    expect(autoRenewAttemptAllowed({ priorAttempts: 1, lastAttemptAtMs: nowMs - 1000, nowMs })).toBe(false);
    expect(autoRenewAttemptAllowed({ priorAttempts: 1, lastAttemptAtMs: nowMs - 4 * 86_400_000, nowMs })).toBe(true);
    expect(autoRenewAttemptAllowed({ priorAttempts: AUTO_RENEW_MAX_ATTEMPTS, lastAttemptAtMs: null, nowMs })).toBe(false);
  });
});

describe("saklı kart tahsilatı doğrulaması (imza + mutabakat)", () => {
  afterEach(() => vi.unstubAllEnvs());

  function signed(overrides: Partial<StoredCardPaymentResult> = {}): StoredCardPaymentResult {
    const result: StoredCardPaymentResult = {
      status: "success",
      paymentId: "99001",
      price: "1200.00",
      paidPrice: "1200.00",
      currency: "TRY",
      basketId: "es-abc",
      conversationId: "es-abc",
      fraudStatus: 1,
      ...overrides,
    };
    result.signature = createPaymentAuthResponseSignature(secret, result)!;
    return result;
  }
  const expected = { conversationId: "es-abc", basketId: "es-abc", amountTry: 1200 };

  it("imza alan sırası paymentId:currency:basketId:conversationId:paidPrice:price (sondaki sıfır atılır)", () => {
    const r = signed();
    const manual = createHmac("sha256", secret).update("99001:TRY:es-abc:es-abc:1200:1200").digest("hex");
    expect(r.signature).toBe(manual);
    expect(verifyPaymentAuthResponseSignature(r, secret)).toBe(true);
  });

  it("geçerli yanıtı kabul eder", () => {
    vi.stubEnv("IYZICO_API_KEY", "k");
    vi.stubEnv("IYZICO_SECRET_KEY", secret);
    expect(verifyStoredCardPayment(signed(), expected).paymentId).toBe("99001");
  });

  it.each([
    ["imza bozuk", { signature: "0".repeat(64) }],
    ["tutar farklı", { paidPrice: "1.00", price: "1.00" }],
    ["fraud onaysız", { fraudStatus: 0 }],
    ["durum başarısız", { status: "failure" }],
    ["conversationId farklı", { conversationId: "es-evil" }],
    ["para birimi farklı", { currency: "USD" }],
  ])("reddeder: %s", (_name, patch) => {
    vi.stubEnv("IYZICO_API_KEY", "k");
    vi.stubEnv("IYZICO_SECRET_KEY", secret);
    const r = "signature" in patch ? { ...signed(), ...patch } : signed(patch as Partial<StoredCardPaymentResult>);
    expect(() => verifyStoredCardPayment(r, expected)).toThrow();
  });
});
