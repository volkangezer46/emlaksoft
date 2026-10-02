import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  isTwoFactorCookieValid,
  twoFactorBindingFromClaims,
  twoFactorCookieValue,
  type TwoFactorSessionBinding,
} from "./two-factor";

const previousSecret = process.env.TWO_FACTOR_COOKIE_SECRET;
const now = Date.UTC(2026, 7, 2, 12, 0, 0);
const binding: TwoFactorSessionBinding = {
  userId: "11111111-1111-1111-1111-111111111111",
  sessionId: "22222222-2222-2222-2222-222222222222",
  profileVersion: 3,
  sessionExpiresAt: Math.floor(now / 1000) + 3_600,
};

beforeEach(() => {
  process.env.TWO_FACTOR_COOKIE_SECRET = "test-only-secret-that-is-longer-than-thirty-two-characters";
});

afterAll(() => {
  if (previousSecret === undefined) delete process.env.TWO_FACTOR_COOKIE_SECRET;
  else process.env.TWO_FACTOR_COOKIE_SECRET = previousSecret;
});

describe("session-bound two-factor cookie", () => {
  it("accepts only the user, Supabase session and profile version it was issued for", async () => {
    const token = await twoFactorCookieValue(binding, now);
    expect(await isTwoFactorCookieValid(token, binding, now + 1_000)).toBe(true);
    expect(
      await isTwoFactorCookieValid(token, { ...binding, sessionId: "other-session" }, now + 1_000),
    ).toBe(false);
    expect(
      await isTwoFactorCookieValid(token, { ...binding, profileVersion: 4 }, now + 1_000),
    ).toBe(false);
  });

  it("rejects tampering and expires no later than the Supabase session", async () => {
    const token = await twoFactorCookieValue(binding, now);
    const tampered = `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;
    expect(await isTwoFactorCookieValid(tampered, binding, now + 1_000)).toBe(false);
    expect(await isTwoFactorCookieValid(token, binding, now + 3_601_000)).toBe(false);
  });

  it("fails closed when the dedicated secret is missing", async () => {
    delete process.env.TWO_FACTOR_COOKIE_SECRET;
    await expect(twoFactorCookieValue(binding, now)).rejects.toThrow("TWO_FACTOR_COOKIE_SECRET");
    expect(await isTwoFactorCookieValid("anything", binding, now)).toBe(false);
  });

  it("derives a binding only from matching verified claims", () => {
    expect(
      twoFactorBindingFromClaims(binding.userId, 3, {
        sub: binding.userId,
        session_id: binding.sessionId,
        exp: binding.sessionExpiresAt,
      }),
    ).toEqual(binding);
    expect(
      twoFactorBindingFromClaims(binding.userId, 3, {
        sub: "different-user",
        session_id: binding.sessionId,
      }),
    ).toBeNull();
  });
});
