import { describe, expect, it } from "vitest";
import { isDemoLoginEnabled, isPlatformDemoPersonaAllowed } from "./demo-environment";
import { productionDemoFlagViolations } from "./deployment-env";

const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: "production", VERCEL_ENV: "production", ...extra });

describe("production demo girişi (açık opt-in)", () => {
  it("bayrak yoksa production'da hiçbir demo kimliği açık değildir", () => {
    expect(isDemoLoginEnabled(prod())).toBe(false);
    expect(isPlatformDemoPersonaAllowed(prod())).toBe(false);
  });

  it("ENABLE_DEMO_LOGIN production'da tek başına hiçbir şey açmaz", () => {
    expect(isDemoLoginEnabled(prod({ ENABLE_DEMO_LOGIN: "true" }))).toBe(false);
    expect(isPlatformDemoPersonaAllowed(prod({ ENABLE_DEMO_LOGIN: "true" }))).toBe(false);
  });

  it("ofis opt-in'i yalnız ofis kartlarını açar, platform kartlarını değil", () => {
    const env = prod({ PRODUCTION_DEMO_LOGIN_OPT_IN: "true" });
    expect(isDemoLoginEnabled(env)).toBe(true);
    expect(isPlatformDemoPersonaAllowed(env)).toBe(false);
  });

  it("platform opt-in'i tek başına yetmez; genel demo opt-in'i de gerekir", () => {
    expect(isPlatformDemoPersonaAllowed(prod({ PRODUCTION_PLATFORM_DEMO_OPT_IN: "true" }))).toBe(false);
  });

  it("iki opt-in birlikte açıkken süper admin dahil tüm kartlar açıktır", () => {
    const env = prod({ PRODUCTION_DEMO_LOGIN_OPT_IN: "true", PRODUCTION_PLATFORM_DEMO_OPT_IN: "true" });
    expect(isDemoLoginEnabled(env)).toBe(true);
    expect(isPlatformDemoPersonaAllowed(env)).toBe(true);
  });

  it("geçersiz bayrak değeri açmaz", () => {
    expect(isDemoLoginEnabled(prod({ PRODUCTION_DEMO_LOGIN_OPT_IN: "evet" }))).toBe(false);
  });

  it("yeni bayraklar production build'inin yasak demo bayrakları listesine takılmaz", () => {
    const env = prod({ PRODUCTION_DEMO_LOGIN_OPT_IN: "true", PRODUCTION_PLATFORM_DEMO_OPT_IN: "true" });
    expect(productionDemoFlagViolations(env)).toEqual([]);
  });

  it("eski yasak bayraklar production'da hâlâ build'i reddeder", () => {
    expect(productionDemoFlagViolations(prod({ ENABLE_DEMO_LOGIN: "true" }))).toEqual(["ENABLE_DEMO_LOGIN"]);
    expect(productionDemoFlagViolations(prod({ ALLOW_PLATFORM_DEMO: "true" }))).toEqual(["ALLOW_PLATFORM_DEMO"]);
  });
});
