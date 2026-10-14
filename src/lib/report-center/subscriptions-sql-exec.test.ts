import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { SUBSCRIPTION_PER_OWNER_MAX } from "./schedule";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261014004000 — rapor abonelikleri DB kapıları. Doğrudan PostgREST yazımına karşı:
 * sahip başına tavan, `next_run_at` alt sınırı (teslim kuyruğunun başına geçilemez), zamanlama/son durum kolonları
 * authenticated'a kapalı; alıcı kendini RPC ile çıkarır; ofis sahibi/gm ofisteki aboneliği durdurur, danışman başkasınınkini
 * durduramaz; başka ofis görünmez. Gerçek migration küçük bir Supabase taklidi üzerinde `set role authenticated` ile koşar.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
grant usage on schema auth, public to authenticated, anon, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(current_setting('test.role', true), '') $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, role text);
create table public.platform_staff(id uuid primary key default gen_random_uuid());
`;

describe.skipIf(!mod)("rapor abonelikleri: DB kapıları (20261014004000)", () => {
  let db: Db;
  let T1: string, T2: string, OWNER: string, GM: string, ADV: string, ADV2: string, OUT: string;

  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const admin = async () => db.exec(`reset role; select set_config('request.jwt.claim.sub','',false)`);
  const as = async (uid: string, tenant: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const insertSub = (owner: string, tenant: string, recipients: string[], nextRunAt = "now() + interval '1 day'") =>
    q(
      `insert into public.report_subscriptions(scope, tenant_id, user_id, report_id, name, format, frequency, recipient_ids, next_run_at)
       values ('tenant', $1, $2, 'musteriler', 'Abonelik', 'xlsx', 'daily', $3::uuid[], ${nextRunAt}) returning id, next_run_at`,
      [tenant, owner, `{${recipients.join(",")}}`],
    );

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261014004000_report_subscriptions.sql").replace(/notify pgrst[^;]*;/g, ""));
    await admin();
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (t: string, role: string) => (await q(`insert into public.profiles(tenant_id, role) values ($1,$2) returning id`, [t, role]))[0]!.id as string;
    OWNER = await prof(T1, "owner");
    GM = await prof(T1, "gm");
    ADV = await prof(T1, "advisor");
    ADV2 = await prof(T1, "advisor");
    OUT = await prof(T2, "advisor");
  });

  beforeEach(async () => {
    await admin();
    await q(`delete from public.report_subscriptions`);
  });

  it(`sahip başına tavan ${SUBSCRIPTION_PER_OWNER_MAX}: doğrudan PostgREST ile fazlası eklenemez`, async () => {
    await as(ADV, T1, "advisor");
    for (let i = 0; i < SUBSCRIPTION_PER_OWNER_MAX; i++) await insertSub(ADV, T1, [ADV]);
    await expect(insertSub(ADV, T1, [ADV])).rejects.toThrow(/report_subscription_limit/);
    // Servis rolü (cron/platform) tavana takılmaz; başka kullanıcının tavanı ayrıdır.
    await as(ADV2, T1, "advisor");
    await expect(insertSub(ADV2, T1, [ADV2])).resolves.toHaveLength(1);
  });

  it("geçmiş next_run_at kuyruğun başına geçemez (alt sınır now()); zamanlama kolonu güncellenemez", async () => {
    await as(ADV, T1, "advisor");
    const [row] = await insertSub(ADV, T1, [ADV], "'1970-01-01'::timestamptz");
    expect(new Date(String(row!.next_run_at)).getUTCFullYear()).toBeGreaterThan(2000);
    await expect(q(`update public.report_subscriptions set next_run_at = '1970-01-01' where id = $1`, [row!.id])).rejects.toThrow(/permission denied/);
    await expect(q(`update public.report_subscriptions set last_status = 'sent' where id = $1`, [row!.id])).rejects.toThrow(/permission denied/);
    await expect(
      q(
        `insert into public.report_subscriptions(scope, tenant_id, user_id, report_id, name, format, frequency, recipient_ids, next_run_at, last_status)
         values ('tenant', $1, $2, 'musteriler', 'x', 'xlsx', 'daily', $3::uuid[], now(), 'sent')`,
        [T1, ADV, `{${ADV}}`],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("alıcı kendisine geleni görür ve kendini çıkarır; son alıcı çıkınca abonelik durur", async () => {
    await as(ADV, T1, "advisor");
    const [a] = await insertSub(ADV, T1, [ADV, ADV2]);
    const [b] = await insertSub(ADV, T1, [ADV2]);
    await as(ADV2, T1, "advisor");
    expect((await q(`select id from public.report_subscriptions order by created_at`)).map((r) => r.id).sort()).toEqual([a!.id, b!.id].sort());
    // Alıcı tanımı değiştiremez (yalnız RPC).
    expect(await q(`update public.report_subscriptions set active = false where id = $1 returning id`, [a!.id])).toHaveLength(0);
    expect((await q(`select public.report_subscription_leave($1) as r`, [a!.id]))[0]!.r).toBe("left");
    expect((await q(`select public.report_subscription_leave($1) as r`, [b!.id]))[0]!.r).toBe("paused");
    expect((await q(`select public.report_subscription_leave($1) as r`, [a!.id]))[0]!.r).toBe("not_found");
    await admin();
    const rows = await q(`select id, recipient_ids, active from public.report_subscriptions order by created_at`);
    expect(rows.find((r) => r.id === a!.id)).toMatchObject({ recipient_ids: [ADV], active: true });
    expect(rows.find((r) => r.id === b!.id)).toMatchObject({ recipient_ids: [ADV], active: false });
  });

  it("ofis sahibi/gm ofisteki aboneliği durdurur; danışman başkasınınkini durduramaz; başka ofis görmez", async () => {
    await as(ADV, T1, "advisor");
    const [s] = await insertSub(ADV, T1, [ADV]);
    await as(ADV2, T1, "advisor");
    expect(await q(`select id from public.report_subscriptions`)).toHaveLength(0);
    expect(await q(`update public.report_subscriptions set active = false where id = $1 returning id`, [s!.id])).toHaveLength(0);
    await as(GM, T1, "gm");
    expect(await q(`update public.report_subscriptions set active = false where id = $1 returning id`, [s!.id])).toHaveLength(1);
    // Yönetici de yalnız active'i değiştirebilir, silemez.
    expect(await q(`delete from public.report_subscriptions where id = $1 returning id`, [s!.id])).toHaveLength(0);
    await as(OWNER, T1, "owner");
    expect(await q(`select id from public.report_subscriptions`)).toHaveLength(1);
    await as(OUT, T2, "owner");
    expect(await q(`select id from public.report_subscriptions`)).toHaveLength(0);
    expect((await q(`select public.report_subscription_leave($1) as r`, [s!.id]))[0]!.r).toBe("not_found");
  });
});
