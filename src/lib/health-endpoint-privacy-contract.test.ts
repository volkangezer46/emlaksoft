import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/app/api/health/route.ts", "utf8");
const env = readFileSync(".env.example", "utf8");

describe("health endpoint privacy contract", () => {
  it("requires a strong bearer secret and constant-time comparison for details", () => {
    expect(route).toContain("HEALTHCHECK_SECRET");
    expect(route).toContain("secret.length < 32");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain('request.headers.get("authorization")');
  });

  it("keeps release and migration internals out of the public payload", () => {
    expect(route).toMatch(
      /return NextResponse\.json\(\s*detailed\s*\?[\s\S]*?:\s*publicPayload/,
    );
    expect(route).toContain("const publicPayload");
    expect(route).toContain("const release = releaseMetadata()");
    expect(route).toContain("release: { ...release, ready: releaseIdentityReady }");
    expect(env).toContain("HEALTHCHECK_SECRET=");
  });

  it("tolerates Next build constants that are not runtime strings", () => {
    expect(route).toContain('typeof candidate === "string" ? candidate.trim() : ""');
    expect(route).toContain("runtimeEnvString(process.env.NEXT_DEPLOYMENT_ID)");
    expect(route).not.toContain("process.env.NEXT_DEPLOYMENT_ID?.trim()");
  });

  it("fails production readiness shut when release identity or migration expectations are missing", () => {
    expect(route).toContain('getDeploymentStage(process.env) === "production"');
    expect(route).not.toContain('process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"');
    expect(route).toContain("!requireReleaseContract");
    expect(route).toContain("releaseIdentityReady");
    expect(route).toContain(
      "databaseReady && migrationReady !== false && releaseIdentityReady",
    );
  });
});
