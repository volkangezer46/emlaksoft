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
    // Herkese açık yanıt yalnız {ok}: db/ms/at/status ayrıntısı yalnız secret sahibine.
    const publicPayloads = [...route.matchAll(/const publicPayload = (\{[^}]*\});/g)].map((m) => m[1]);
    expect(publicPayloads).toEqual(["{ ok: ready }", "{ ok: false }"]);
    expect(route).toContain("const release = releaseMetadata()");
    expect(route).toContain("release: { ...release, ready: releaseIdentityReady }");
    expect(env).toContain("HEALTHCHECK_SECRET=");
  });

  it("probes auth/storage/realtime only in detailed mode and never lets them fail readiness", () => {
    expect(route).toMatch(/const servicesPromise = detailed\s*\?\s*probeSupabaseServices\(/);
    expect(route).toContain('services: services?.overall ?? "degraded"');
    // Genel hazır olma kararı alt servislere bağlı değildir.
    const readyLine = route.match(/const ready = ([^;]+);/)?.[1] ?? "";
    expect(readyLine).toBe("databaseReady && migrationReady !== false && releaseIdentityReady");
    expect(readyLine).not.toContain("services");
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
