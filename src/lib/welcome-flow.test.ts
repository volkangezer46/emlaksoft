import { describe, expect, it } from "vitest";
import { shouldShowWelcome } from "./welcome-flow";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const day = 86_400_000;

describe("welcome-flow", () => {
  const base = { role: "advisor", dismissed: false, profileCreatedAt: new Date(NOW - 2 * day).toISOString(), nowMs: NOW };

  it("yeni danışman için gösterir", () => {
    expect(shouldShowWelcome(base)).toBe(true);
  });

  it("kapatılmışsa, danışman değilse veya eski hesapsa göstermez", () => {
    expect(shouldShowWelcome({ ...base, dismissed: true })).toBe(false);
    expect(shouldShowWelcome({ ...base, role: "owner" })).toBe(false);
    expect(shouldShowWelcome({ ...base, profileCreatedAt: new Date(NOW - 45 * day).toISOString() })).toBe(false);
  });

  it("geçersiz/eksik tarihte göstermez", () => {
    expect(shouldShowWelcome({ ...base, profileCreatedAt: null })).toBe(false);
    expect(shouldShowWelcome({ ...base, profileCreatedAt: "x" })).toBe(false);
    expect(shouldShowWelcome({ ...base, profileCreatedAt: new Date(NOW + day).toISOString() })).toBe(false);
  });
});
