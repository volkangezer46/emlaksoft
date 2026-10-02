import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const config = read("playwright.config.ts");
const setup = read("e2e/auth.setup.ts");
const seed = read("scripts/e2e-user.ts");

describe("authenticated E2E safety contract", () => {
  it("disables authenticated projects without an explicit mutation gate", () => {
    expect(config).toContain('process.env.E2E_MUTATION_ALLOWED === "true"');
    expect(config).toContain("authenticatedE2EEnabled ? /auth\\.setup\\.ts/ : /$^/");
    expect(config).toContain("authenticatedE2EEnabled ? /.*\\.spec\\.ts/ : /$^/");
  });

  it("requires caller-owned credentials and has no repository password fallback", () => {
    for (const source of [setup, seed]) {
      expect(source).toContain("E2E_USER_EMAIL");
      expect(source).toContain("E2E_USER_PASSWORD");
      expect(source).not.toMatch(/E2E_(?:EMAIL|PASSWORD)\s*=\s*["'][^"']+["']/);
    }
    expect(setup).toContain("PASSWORD.length < 16");
    expect(seed).toContain("E2E_PASSWORD.length < 16");
  });

  it("retains an extra confirmation for hosted database mutation", () => {
    expect(seed).toContain('process.env.SEED_CONFIRM !== "1"');
    expect(seed).toContain("!isLocalDb");
  });
});
