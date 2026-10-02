import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashOtpForStorage,
  OtpHashConfigurationError,
  verifyOtpHash,
  type OtpHashEnvironment,
} from "./otp-hmac";

const configured = {
  OTP_HMAC_SECRET: "test-only-independent-otp-pepper-with-at-least-32-bytes",
} satisfies OtpHashEnvironment;

describe("versioned OTP HMAC storage", () => {
  it("stores no raw code and verifies only the intended purpose and subject", () => {
    const stored = hashOtpForStorage("042731", "login", "user-1", configured);

    expect(stored).toMatch(/^hmac-sha256-v1:[a-f0-9]{64}$/);
    expect(stored).not.toContain("042731");
    expect(verifyOtpHash("042731", stored, "login", "user-1", configured)).toBe(true);
    expect(verifyOtpHash("042732", stored, "login", "user-1", configured)).toBe(false);
    expect(verifyOtpHash("042731", stored, "login", "user-2", configured)).toBe(false);
    expect(
      verifyOtpHash("042731", stored, "contract-signature", "user-1", configured),
    ).toBe(false);
  });

  it("fails closed for tampered and unknown versioned records", () => {
    const stored = hashOtpForStorage("123456", "contract-signature", "signer-1", configured);
    const tampered = `${stored.slice(0, -1)}${stored.endsWith("0") ? "1" : "0"}`;

    expect(
      verifyOtpHash("123456", tampered, "contract-signature", "signer-1", configured),
    ).toBe(false);
    expect(
      verifyOtpHash(
        "123456",
        `hmac-sha256-v2:${"0".repeat(64)}`,
        "contract-signature",
        "signer-1",
        configured,
      ),
    ).toBe(false);
  });

  it("accepts only unversioned legacy SHA-256 values during the short rollout window", () => {
    const legacy = createHash("sha256").update("654321").digest("hex");

    expect(verifyOtpHash("654321", legacy, "login", "user-1", {})).toBe(true);
    expect(verifyOtpHash("654320", legacy, "login", "user-1", {})).toBe(false);
    expect(verifyOtpHash("654321", `legacy:${legacy}`, "login", "user-1", {})).toBe(false);
  });

  it("requires an independent strong pepper for every newly issued/current OTP", () => {
    expect(() => hashOtpForStorage("123456", "login", "user-1", {})).toThrow(
      OtpHashConfigurationError,
    );
    expect(() =>
      verifyOtpHash(
        "123456",
        `hmac-sha256-v1:${"0".repeat(64)}`,
        "login",
        "user-1",
        {},
      ),
    ).toThrow(OtpHashConfigurationError);
  });
});
