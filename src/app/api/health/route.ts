import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeploymentStage } from "@/lib/deployment-env";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
};

type MigrationStatus =
  | "ready"
  | "pending"
  | "drift"
  | "observed"
  | "unknown"
  | "unavailable"
  | "misconfigured";

// Next may compile unset framework-owned variables (notably
// NEXT_DEPLOYMENT_ID) to the boolean literal `false`. Never assume an env-like
// build constant is a string at this runtime boundary.
function runtimeEnvString(candidate: unknown): string {
  return typeof candidate === "string" ? candidate.trim() : "";
}

function releaseMetadata() {
  const rawSha =
    runtimeEnvString(process.env.VERCEL_GIT_COMMIT_SHA) ||
    runtimeEnvString(process.env.GITHUB_SHA) ||
    runtimeEnvString(process.env.RELEASE_SHA) ||
    null;

  return {
    sha: rawSha ? rawSha.slice(0, 12) : null,
    deploymentId: runtimeEnvString(process.env.NEXT_DEPLOYMENT_ID) || null,
    environment:
      runtimeEnvString(process.env.VERCEL_ENV) ||
      runtimeEnvString(process.env.NODE_ENV) ||
      "unknown",
  };
}

function productionReadinessRequired() {
  return getDeploymentStage(process.env) === "production";
}

function detailedHealthAuthorized(request: Request) {
  const secret = runtimeEnvString(process.env.HEALTHCHECK_SECRET);
  if (!secret || secret.length < 32) return false;
  const supplied = request.headers.get("authorization")?.trim() ?? "";
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(supplied, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const started = Date.now();
  const at = new Date().toISOString();
  const detailed = detailedHealthAuthorized(request);
  const release = releaseMetadata();
  const requireReleaseContract = productionReadinessRequired();
  const expectedVersion = runtimeEnvString(process.env.RELEASE_MIGRATION) || null;
  const expectedChecksum = runtimeEnvString(process.env.RELEASE_MIGRATION_CHECKSUM) || null;
  const hasMigrationExpectation = Boolean(expectedVersion || expectedChecksum);
  const migrationExpectationValid = hasMigrationExpectation
    ? Boolean(
      expectedVersion &&
        /^\d{14}[a-z]?_[a-z0-9_]+\.sql$/.test(expectedVersion) &&
        expectedChecksum &&
        /^[a-f0-9]{16}$/i.test(expectedChecksum),
      )
    : !requireReleaseContract;
  const releaseIdentityReady = !requireReleaseContract || Boolean(release.sha);

  try {
    const admin = createAdminClient();
    const databaseStarted = Date.now();
    const databasePromise = admin.from("tenants").select("id").limit(1);
    const migrationPromise = expectedVersion
      ? admin
          .from("schema_migrations")
          .select("version, checksum, applied_at")
          .eq("version", expectedVersion)
          .maybeSingle()
      : admin
          .from("schema_migrations")
          .select("version, checksum, applied_at")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

    const [databaseResult, migrationResult] = await Promise.all([databasePromise, migrationPromise]);
    const databaseLatencyMs = Date.now() - databaseStarted;
    const databaseReady = !databaseResult.error;

    let migrationStatus: MigrationStatus = "unknown";
    let migrationReady: boolean | null = null;
    const applied = migrationResult.data
      ? {
          version: String(migrationResult.data.version),
          checksum: String(migrationResult.data.checksum),
          appliedAt: migrationResult.data.applied_at ? String(migrationResult.data.applied_at) : null,
        }
      : null;

    if (!migrationExpectationValid) {
      migrationStatus = "misconfigured";
      migrationReady = false;
    } else if (migrationResult.error) {
      migrationStatus = "unavailable";
      migrationReady = expectedVersion ? false : null;
      console.error("health migration check failed", { code: migrationResult.error.code });
    } else if (!expectedVersion) {
      migrationStatus = applied ? "observed" : "unknown";
    } else if (!applied) {
      migrationStatus = "pending";
      migrationReady = false;
    } else if (expectedChecksum && applied.checksum !== expectedChecksum) {
      migrationStatus = "drift";
      migrationReady = false;
    } else {
      migrationStatus = "ready";
      migrationReady = true;
    }

    if (databaseResult.error) {
      console.error("health database check failed", { code: databaseResult.error.code });
    }

    // Production readiness is a deployment contract, not merely a database
    // connectivity probe. Missing release SHA or expected migration fails shut.
    const ready = databaseReady && migrationReady !== false && releaseIdentityReady;
    const elapsedMs = Date.now() - started;
    const publicPayload = {
      ok: ready,
      status: ready ? "ready" : "not_ready",
      // Backward-compatible aliases for existing uptime probes.
      db: databaseReady ? "up" : "down",
      ms: elapsedMs,
      at,
    };
    return NextResponse.json(
      detailed
        ? {
            ...publicPayload,
            checks: {
              database: {
                status: databaseReady ? "up" : "down",
                latencyMs: databaseLatencyMs,
              },
              migrations: {
                status: migrationStatus,
                ready: migrationReady,
                expected: hasMigrationExpectation
                  ? { version: expectedVersion, checksum: expectedChecksum }
                  : null,
                applied,
              },
            },
            release: { ...release, ready: releaseIdentityReady },
            elapsedMs,
          }
        : publicPayload,
      { status: ready ? 200 : 503, headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("health check failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    const publicPayload = {
      ok: false,
      status: "not_ready",
      db: "down",
      ms: Date.now() - started,
      at,
    };
    return NextResponse.json(
      detailed
        ? {
            ...publicPayload,
            checks: {
              database: { status: "down", latencyMs: Date.now() - started },
              migrations: {
                status: "unavailable" satisfies MigrationStatus,
                ready: hasMigrationExpectation ? false : null,
                expected: hasMigrationExpectation
                  ? { version: expectedVersion, checksum: expectedChecksum }
                  : null,
                applied: null,
              },
            },
            release: { ...release, ready: releaseIdentityReady },
            elapsedMs: Date.now() - started,
          }
        : publicPayload,
      { status: 503, headers: noStoreHeaders },
    );
  }
}
