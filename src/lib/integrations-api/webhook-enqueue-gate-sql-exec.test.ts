import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000320 + 20261007000600 gerçek PL/pgSQL ile. Şema sadeleştirilmiş taklittir
 * (tenants/customers/properties/deals, auth.uid(), current_tenant_id(), has_effective_permission yapılandırılabilir).
 * RLS gerçek rollerle DENENMEZ (tek bağlantı süper kullanıcı); DEFINER RPC davranışı sınanır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.tenant', true),'')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select (p_module || ':' || p_action) = any (string_to_array(coalesce(current_setting('request.jwt.claim.perms', true), ''), ','))
$$;
create table public.tenants(id uuid primary key default gen_random_uuid(), status text default 'active');
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text, phone text, email text, source text,
  customer_types text[], is_sample boolean default false, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_code text, title text, status text,
  transaction_type text, property_type text, list_price numeric, features jsonb default '{}', province_id int, district_id int,
  is_sample boolean default false, deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid, deal_type text, stage text, deal_value numeric,
  property_id uuid, customer_id uuid, is_sample boolean default false, created_at timestamptz default now(), updated_at timestamptz default now());
`;

describe.skipIf(!mod)("webhook kuyruğu izin kapısı — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  let T: string;
  let C: string;
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, perms: string) => {
    await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false), set_config('request.jwt.claim.tenant','${T}',false), set_config('request.jwt.claim.perms','${perms}',false)`);
  };
  const enqueue = (event: string, type: string, id: string) =>
    q(`select * from public.webhook_enqueue($1,$2,$3::uuid)`, [event, type, id]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261007000320_webhooks_api_keys.sql"));
    await db.exec(read("supabase/migrations/20261007000600_webhook_enqueue_gate.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    C = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Ayşe') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.webhook_endpoints(tenant_id, url, events) values ($1, 'https://ornek.com/hook', array['customer.created','customer.updated'])`, [T]);
  });

  it("modül izni olmayan üye olay üretemez (sessizce boş)", async () => {
    await as(U2, "customers:view");
    expect(await enqueue("customer.created", "customer", C)).toHaveLength(0);
    expect((await q(`select count(*)::int n from public.webhook_deliveries`))[0]!.n).toBe(0);
  });

  it("izinli kullanıcı kuyruğa yazar; 30 sn içinde aynı olay ikinci kez yazılmaz", async () => {
    await as(U1, "customers:create,customers:edit");
    const rows = await enqueue("customer.created", "customer", C);
    expect(rows).toHaveLength(1);
    expect(await enqueue("customer.created", "customer", C)).toHaveLength(0);
    expect((await q(`select enqueued_by from public.webhook_deliveries`))[0]!.enqueued_by).toBe(U1);
  });

  it("olay ve varlık türü uyuşmazsa reddedilir", async () => {
    await as(U1, "customers:create,properties:edit");
    await expect(enqueue("customer.created", "property", C)).rejects.toThrow(/uyusmuyor/);
  });

  it("teslim işaretini yalnız kuyruğa yazan kullanıcı ve yalnız ilk denemede koyabilir", async () => {
    const id = (await q(`select id from public.webhook_deliveries limit 1`))[0]!.id as string;
    await as(U2, "customers:create,customers:edit");
    await q(`select public.webhook_mark_delivery($1::uuid, true, 200, null)`, [id]);
    expect((await q(`select status, attempts from public.webhook_deliveries where id=$1`, [id]))[0]).toMatchObject({ status: "pending", attempts: 0 });
    await as(U1, "customers:create");
    await q(`select public.webhook_mark_delivery($1::uuid, false, 500, 'HTTP 500')`, [id]);
    expect((await q(`select status, attempts from public.webhook_deliveries where id=$1`, [id]))[0]).toMatchObject({ status: "pending", attempts: 1 });
    // İkinci deneme kullanıcıdan gelemez (cron/service_role işi).
    await q(`select public.webhook_mark_delivery($1::uuid, true, 200, null)`, [id]);
    expect((await q(`select status, attempts from public.webhook_deliveries where id=$1`, [id]))[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("rollback 000320 davranışına döner (izin kapısı kalkar)", async () => {
    await db.exec(read("supabase/rollbacks/20261007000600_webhook_enqueue_gate.rollback.sql"));
    await as(U2, "");
    const rows = await enqueue("customer.updated", "customer", C);
    expect(rows).toHaveLength(1);
  });
});
