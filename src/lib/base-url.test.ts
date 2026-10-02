import { afterEach, describe, expect, it, vi } from "vitest";
import { getBaseUrl } from "@/lib/base-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public base URL", () => {
  it("prefers and normalizes the explicit application URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com///");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "ignored.vercel.app");
    expect(getBaseUrl()).toBe("https://app.example.com");
  });

  it("uses Vercel's stable production domain instead of a deployment URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "emlaksoft.vercel.app/");
    expect(getBaseUrl()).toBe("https://emlaksoft.vercel.app");
  });

  it("never emits localhost from a production fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(getBaseUrl()).toBe("https://emlaksoft.vercel.app");
  });

  it("keeps localhost available for actual local development", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });
});
