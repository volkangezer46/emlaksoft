import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeCron, isCronAuthorized } from "@/lib/cron-auth";

const req = (authorization?: string) =>
  new Request("https://example.test/api/cron/x", { headers: authorization ? { authorization } : {} });

describe("isCronAuthorized", () => {
  it("doğru Bearer'ı kabul eder", () => {
    expect(isCronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });
  it("yanlış, eksik ve farklı uzunluktaki başlığı reddeder", () => {
    expect(isCronAuthorized("Bearer yanlis", "s3cret")).toBe(false);
    expect(isCronAuthorized("Bearer s3cre", "s3cret")).toBe(false);
    expect(isCronAuthorized("s3cret", "s3cret")).toBe(false);
    expect(isCronAuthorized(null, "s3cret")).toBe(false);
  });
  it("secret yoksa/boşsa hiçbir başlığı kabul etmez ('Bearer undefined' bypass'ı yok)", () => {
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "  ")).toBe(false);
  });
});

describe("authorizeCron", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("secret tanımsızsa 503 döner", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = authorizeCron(req("Bearer x"));
    expect(res?.status).toBe(503);
  });
  it("yanlış Bearer 401, doğru Bearer null (yetkili)", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(authorizeCron(req("Bearer yanlis"))?.status).toBe(401);
    expect(authorizeCron(req())?.status).toBe(401);
    expect(authorizeCron(req("Bearer s3cret"))).toBeNull();
  });
});
