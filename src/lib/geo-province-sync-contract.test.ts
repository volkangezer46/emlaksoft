import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("province-scoped geo synchronization contract", () => {
  const migration = source("supabase/migrations/20260811000010_geo_province_sync_jobs.sql");
  const action = source("src/app/actions/geo-admin.ts");
  const page = source("src/app/admin/geo/page.tsx");
  const row = source("src/app/admin/geo/province-row.tsx");
  const worker = source("src/lib/geo-province-sync.ts");
  const provider = source("src/lib/geo-provider.ts");
  const route = source("src/app/api/cron/geo-province-sync/route.ts");

  it("keeps the queue and status projection service-owned", () => {
    expect(migration).toContain("create table public.geo_sync_jobs");
    expect(migration).toContain("alter table public.geo_sync_jobs enable row level security");
    expect(migration).toMatch(/revoke all privileges on table public\.geo_sync_jobs\s+from public, anon, authenticated/i);
    expect(migration).toContain("create or replace view public.geo_province_sync_status");
    expect(migration).toMatch(/revoke all privileges on table public\.geo_province_sync_status\s+from public, anon, authenticated/i);
    expect(migration).toContain("geo_sync_jobs_one_active_per_province");
  });

  it("selects one province, pauses competing geo work and leases only one worker", () => {
    expect(migration).toContain("create or replace function public.enqueue_geo_province_sync");
    expect(migration).toContain("q.province_id <> p_province_id");
    expect(migration).toContain("set status = 'paused'");
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('geo-province-sync-claim-v1'))");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("if exists (");
    expect(migration).toContain("where q.status = 'running'");
  });

  it("applies one complete snapshot atomically under an exact lease", () => {
    expect(migration).toContain("create or replace function public.apply_geo_province_sync");
    expect(migration).toContain("jsonb_array_length(p_payload -> 'districts') <> v_expected_districts");
    expect(migration).toContain("jsonb_array_length(p_payload -> 'neighborhoods') <> v_expected_neighborhoods");
    expect(migration).toContain("and q.lease_token = p_lease_token");
    expect(migration).not.toMatch(/delete\s+from\s+public\.geo_(?:provinces|districts|neighborhoods)/i);
    expect(migration).not.toMatch(/set\s+is_active\s*=\s*true/i);
    expect(migration).toContain("'partial'");
    expect(migration).toContain("'succeeded'");
    expect(migration).toContain("is_canonical");
    expect(migration).toContain("duplicate_source_name");
    expect(migration).toContain("newer.source_id > s.source_id");
  });

  it("uses bounded retry and terminal dead-letter states", () => {
    expect(migration).toContain("create or replace function public.fail_geo_sync_job");
    expect(migration).toContain("attempt_count >= 8");
    expect(migration).toContain("'dead_letter'");
    expect(migration).toContain("p_retryable");
    expect(migration).toContain("last_error_code");
  });

  it("validates the platform module and re-reads the selected province", () => {
    expect(action).not.toContain("requirePlatformStaff");
    expect(action.match(/requirePlatformModule\("geo"\)/g)?.length).toBeGreaterThanOrEqual(5); // yazan action'lar writer() kapısından geçer
    expect(action).toContain("UUID_PATTERN.test(provinceId)");
    expect(action).toContain('getAdminRow("province", provinceId)');
    expect(action).toContain("enqueue_geo_province_sync");
    expect(action).toContain("province.plateCode === 46 ? 1_000 : 100");
    expect(action).not.toContain("fetchGeoProvinceSnapshot");
  });

  it("routes provider traffic through the hardened fixed-origin boundary", () => {
    expect(provider).toContain('const TURKIYE_API_ORIGIN = "https://api.turkiyeapi.dev"');
    expect(provider).toContain("fetchExternal(");
    expect(provider).not.toMatch(/\bfetch\s*\(/);
    expect(provider).toContain("MAX_RESPONSE_BYTES");
    expect(provider).toContain("REQUEST_TIMEOUT_MS");
    expect(provider).toContain("district_neighborhood_count_mismatch");
    expect(provider).toContain("source_version_mismatch");
  });

  it("claims, resolves and applies through the queue RPC boundary", () => {
    expect(worker).toContain('admin.rpc("claim_geo_sync_job"');
    expect(worker).toContain('getProvince(job.provinceId)');
    expect(worker).toContain("fetchGeoProvinceSnapshot(plateCode)");
    expect(worker).toContain('admin.rpc("apply_geo_province_sync"');
    expect(worker).toContain('admin.rpc("fail_geo_sync_job"');
    expect(worker).toContain("retryableDatabaseCode");
  });

  it("exposes one-click status UI with a single aggregate status query", () => {
    expect(page).toContain('.from("geo_province_sync_status").select("*")');
    expect(page).toContain("GeoSyncAutoRefresh");
    expect(row).toContain("Tara ve tamamla");
    expect(row).toContain("enqueueProvinceGeoSync");
    expect(row).toContain("Bekletiliyor");
    expect(row).toContain("İnceleme gerekli");
  });

  it("keeps cron authorization, heartbeat and monitoring names aligned", () => {
    expect(route).toContain("process.env.CRON_SECRET");
    expect(route).toContain('recordHeartbeat("geo-province-sync"');
    expect(source("src/lib/cron-jobs.ts")).toContain('job: "geo-province-sync"');
    expect(source("vercel.json")).toContain('"path": "/api/cron/geo-province-sync"');
  });
});
