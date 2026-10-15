import { describe, expect, it } from "vitest";
import { WELCOME_DONE_UI_KEY, isWelcomeDone, shouldShowWelcome } from "./welcome-flow";
import { isUiStateKey } from "./ui-state";
import { readFileSync } from "node:fs";

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

  it("tamamlanma profil arayüz durumunda (cihazlar arası) tutulur, çerezde değil (PUB-11)", () => {
    expect(isUiStateKey(WELCOME_DONE_UI_KEY)).toBe(true);
    expect(isWelcomeDone({ [WELCOME_DONE_UI_KEY]: "2026-10-03T12:00:00Z" })).toBe(true);
    expect(isWelcomeDone({})).toBe(false);
    expect(isWelcomeDone(null)).toBe(false);
    const gate = readFileSync("src/lib/welcome-state.ts", "utf8");
    expect(gate).not.toMatch(/cookies\(/);
    expect(gate).toContain("readOwnUiState");
    const action = readFileSync("src/app/actions/onboarding-setup.ts", "utf8");
    expect(action).toContain("markUiState(WELCOME_DONE_UI_KEY)");
    expect(action).not.toContain("es_hosgeldin_");
  });
});
