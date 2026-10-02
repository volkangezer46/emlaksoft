import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDemoLoginEnabled, isPlatformDemoPersonaAllowed } from "./demo-environment";
import {
  assertProductionEnvironment,
  assertProductionDemoSafety,
  environmentFlagState,
  getDeploymentStage,
  productionEnvironmentViolations,
  productionDemoFlagViolations,
  type Environment,
} from "./deployment-env";

const env = (values: Record<string, string | undefined>): Environment => values;

const validProduction = (overrides: Record<string, string | undefined> = {}): Environment =>
  env({
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    OTP_HMAC_SECRET: "independent-otp-pepper-with-at-least-32-bytes",
    TWO_FACTOR_COOKIE_SECRET: "independent-2fa-cookie-secret-at-least-32-characters",
    PROPERTY_MEDIA_SIGNING_SECRET: "independent-property-media-secret-at-least-32-characters",
    NEXT_PUBLIC_APP_URL: "https://emlaksoft.example",
    HEALTHCHECK_SECRET: "healthcheck-secret-with-at-least-32-characters",
    RELEASE_MIGRATION: "20260811000010_geo_province_sync_jobs.sql",
    RELEASE_MIGRATION_CHECKSUM: "0123456789abcdef",
    ENABLE_DEMO_LOGIN: "false",
    ...overrides,
  });

describe("deployment environment safety", () => {
  it("gives a real production marker priority over preview/local overrides", () => {
    expect(getDeploymentStage(env({ NODE_ENV: "development" }))).toBe("local");
    expect(getDeploymentStage(env({ NODE_ENV: "production", VERCEL_ENV: "preview" }))).toBe(
      "preview",
    );
    expect(
      getDeploymentStage(env({ VERCEL_ENV: "production", EMLAKSOFT_ENV: "preview" })),
    ).toBe("production");
    expect(getDeploymentStage(env({ NODE_ENV: "production", EMLAKSOFT_ENV: "local" }))).toBe(
      "production",
    );
    expect(getDeploymentStage(env({ NODE_ENV: "production", CI: "true" }))).toBe("production");
  });

  it("accepts only explicit, documented boolean flag spellings", () => {
    expect(environmentFlagState(undefined)).toBe("unset");
    expect(environmentFlagState("YES")).toBe("enabled");
    expect(environmentFlagState("0")).toBe("disabled");
    expect(environmentFlagState("")).toBe("invalid");
    expect(environmentFlagState("sometimes")).toBe("invalid");
  });

  it("fails a production build/start for every current or future demo escape hatch", () => {
    const unsafe = env({
      NODE_ENV: "production",
      ENABLE_DEMO_LOGIN: "true",
      ALLOW_PAYMENT_LINK_DEMO: "1",
      ALLOW_BILLING_DEMO: "yes",
      ALLOW_FUTURE_DEMO: "unexpected",
    });

    expect(productionDemoFlagViolations(unsafe)).toEqual([
      "ALLOW_BILLING_DEMO",
      "ALLOW_FUTURE_DEMO",
      "ALLOW_PAYMENT_LINK_DEMO",
      "ENABLE_DEMO_LOGIN",
    ]);
    expect(() => assertProductionDemoSafety(unsafe)).toThrow(
      /Production refused.*ENABLE_DEMO_LOGIN/,
    );
  });

  it("keeps disabled production safe and blocks all production demo identities at runtime", () => {
    const production = env({
      NODE_ENV: "production",
      ENABLE_DEMO_LOGIN: "false",
      ALLOW_PAYMENT_LINK_DEMO: "0",
      ALLOW_BILLING_DEMO: "off",
    });

    expect(() => assertProductionDemoSafety(production)).not.toThrow();
    expect(isDemoLoginEnabled(production)).toBe(false);
    expect(isPlatformDemoPersonaAllowed(production)).toBe(false);
  });

  it("retains local one-click demo and explicit preview demo access", () => {
    expect(isDemoLoginEnabled(env({ NODE_ENV: "development" }))).toBe(true);
    expect(isDemoLoginEnabled(env({ VERCEL_ENV: "preview" }))).toBe(false);
    const preview = env({ VERCEL_ENV: "preview", ENABLE_DEMO_LOGIN: "true" });
    expect(isDemoLoginEnabled(preview)).toBe(true);
    expect(isPlatformDemoPersonaAllowed(preview)).toBe(false);
    expect(isPlatformDemoPersonaAllowed(env({ NODE_ENV: "development" }))).toBe(true);
  });

  it("fails production boot when universal runtime or release contracts are missing", () => {
    const violations = productionEnvironmentViolations(
      env({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://insecure.example" }),
    );

    expect(violations).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY",
      "OTP_HMAC_SECRET",
      "TWO_FACTOR_COOKIE_SECRET",
      "PROPERTY_MEDIA_SIGNING_SECRET",
      "NEXT_PUBLIC_APP_URL|VERCEL_PROJECT_PRODUCTION_URL",
      "HEALTHCHECK_SECRET",
      "RELEASE_MIGRATION",
      "RELEASE_MIGRATION_CHECKSUM",
    ]);
    expect(() =>
      assertProductionEnvironment(
        validProduction({ HEALTHCHECK_SECRET: "do-not-print-this-value" }),
      ),
    ).toThrow(/HEALTHCHECK_SECRET/);
    try {
      assertProductionEnvironment(
        validProduction({ HEALTHCHECK_SECRET: "do-not-print-this-value" }),
      );
    } catch (error) {
      expect(String(error)).not.toContain("do-not-print-this-value");
    }
  });

  it("accepts preferred or legacy Supabase keys and the stable Vercel production URL", () => {
    expect(() => assertProductionEnvironment(validProduction())).not.toThrow();
    expect(() =>
      assertProductionEnvironment(
        validProduction({
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon",
          SUPABASE_SECRET_KEY: undefined,
          SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
          NEXT_PUBLIC_APP_URL: undefined,
          VERCEL_PROJECT_PRODUCTION_URL: "emlaksoft.vercel.app",
        }),
      ),
    ).not.toThrow();
  });

  it("refuses reused runtime signing material without exposing its value", () => {
    const reused = "do-not-print-shared-runtime-signing-secret-123456789";
    const violations = productionEnvironmentViolations(
      validProduction({
        OTP_HMAC_SECRET: reused,
        TWO_FACTOR_COOKIE_SECRET: reused,
      }),
    );
    expect(violations).toContain(
      "OTP_HMAC_SECRET|TWO_FACTOR_COOKIE_SECRET|PROPERTY_MEDIA_SIGNING_SECRET must be independent",
    );
    expect(violations.join(" ")).not.toContain(reused);
  });

  it("does not require production-only essentials for local, test or preview builds", () => {
    expect(productionEnvironmentViolations(env({ NODE_ENV: "development" }))).toEqual([]);
    expect(productionEnvironmentViolations(env({ NODE_ENV: "test" }))).toEqual([]);
    expect(productionEnvironmentViolations(env({ VERCEL_ENV: "preview" }))).toEqual([]);
  });

  it("wires the config gate and platform defense into their server entry points", () => {
    const config = readFileSync("next.config.ts", "utf8");
    const action = readFileSync("src/app/actions/demo-login.ts", "utf8");
    expect(config).toContain("assertProductionEnvironment(process.env)");
    expect(action).toContain('persona.kind === "platform" && !isPlatformDemoPersonaAllowed()');
  });
});
