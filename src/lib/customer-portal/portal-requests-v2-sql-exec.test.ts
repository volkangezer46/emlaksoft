import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012000200 portal_requests_v2 — gösterim talebi (görev + bildirim), arayış güncelleme isteği
 * (talep DEĞİŞMEZ, tek bekleyen istek), kiracı "Ödedim" bildirimi (tahakkuk 'paid' olmaz), token/KVKK/oran sınırı, rollback.
 * Şema sadeleştirilmiş taklit; v1 migration'ı (20261007000620) önce uygulanır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.has_effective_permission(text, text) returns boolean language sql stable as $$ select false $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), status text not null default 'active');
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text, assigned_to uuid,
  is_sample boolean not null default false, deleted_at timestamptz);
create table public.customer_portal_tokens(id uuid primary key default gen_random_uuid(), tenant_id uuid, customer_id uuid,
  token text not null unique, expires_at timestamptz not null);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_code text, title text, status text,
  assigned_to uuid, is_sample boolean not null default false, deleted_at timestamptz);
create type public.offer_status as enum ('draft', 'submitted', 'countered', 'accepted', 'rejected', 'withdrawn');
create table public.offers(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, customer_id uuid, created_by uuid,
  amount numeric(14,2) not null, status public.offer_status not null default 'draft', notes text, created_at timestamptz default now());
create table public.appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid, customer_id uuid, property_id uuid,
  assigned_to uuid, scheduled_at timestamptz, status text);
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid, title text not null, notes text, kind text, priority text,
  status text, due_at timestamptz, assigned_to uuid, customer_id uuid, property_id uuid, created_at timestamptz default now());
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, renter_customer_id uuid,
  status text not null default 'active', created_by uuid);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid, rental_id uuid references public.rentals(id),
  period date not null, amount numeric(14,2) not null, status text not null default 'pending');
create table public.maintenance_requests(id uuid primary key default gen_random_uuid(), tenant_id uuid, rental_id uuid, title text not null,
  description text, status text not null default 'open', created_at timestamptz default now());
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid, user_id uuid, title text not null, body text,
  href text, kind text not null default 'info', meta jsonb not null default '{}', created_at timestamptz default now());
create table public.customer_demands(id uuid primary key default gen_random_uuid(), tenant_id uuid, customer_id uuid, status text not null default 'active',
  budget_min numeric, budget_max numeric, rooms text);
create table public.owner_portal_tokens(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, token text, expires_at timestamptz);
`;

describe.skipIf(!mod)("portal istekleri v2 (pglite)", () => {
  let db: Db;
  const TOKEN = "c".repeat(64);
  const EXPIRED = "d".repeat(64);
  let T: string, C: string, C2: string, ADV: string, P: string, DEM: string, DEM2: string, RENT: string, CH: string, CH2: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const call = async (token: string, kind: string, payload: unknown) =>
    (await q(`select public.portal_customer_request($1, $2, $3::jsonb) as r`, [token, kind, JSON.stringify(payload)]))[0]!.r as { ok: boolean; code: string };
  const count = async (table: string, where = "true") => (await q(`select count(*)::int n from public.${table} where ${where}`))[0]!.n as number;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    C = (await q(`insert into public.customers(tenant_id, full_name, assigned_to) values ($1, 'Zeynep Kaya', $2) returning id`, [T, ADV]))[0]!.id as string;
    C2 = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Başka Kişi') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.customer_portal_tokens(tenant_id, customer_id, token, expires_at) values ($1,$2,$3, now() + interval '1 day'), ($1,$4,$5, now() - interval '1 day')`, [T, C, TOKEN, C2, EXPIRED]);
    P = (await q(`insert into public.properties(tenant_id, property_code, title, status, assigned_to) values ($1, 'KDK-12', 'Kadıköy 3+1', 'live', $2) returning id`, [T, ADV]))[0]!.id as string;
    DEM = (await q(`insert into public.customer_demands(tenant_id, customer_id, budget_min, budget_max, rooms) values ($1,$2, 5000000, 7000000, '2+1') returning id`, [T, C]))[0]!.id as string;
    DEM2 = (await q(`insert into public.customer_demands(tenant_id, customer_id) values ($1,$2) returning id`, [T, C2]))[0]!.id as string;
    RENT = (await q(`insert into public.rentals(tenant_id, property_id, renter_customer_id) values ($1,$2,$3) returning id`, [T, P, C]))[0]!.id as string;
    CH = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-10-01', 25000) returning id`, [T, RENT]))[0]!.id as string;
    CH2 = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount, status) values ($1,$2,'2026-09-01', 25000, 'paid') returning id`, [T, RENT]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261007000620_customer_portal_requests.sql"));
    await db.exec(read("supabase/migrations/20261012000200_portal_requests_v2.sql"));
  });

  it("geçersiz / süresi dolmuş token yeni türlerde de reddedilir", async () => {
    expect((await call("kisa", "visit", { property_id: P })).code).toBe("invalid_link");
    expect((await call(EXPIRED, "rent_paid", { charge_id: CH })).code).toBe("invalid_link");
    expect((await call(EXPIRED, "demand_update", { demand_id: DEM2, budget_max: 1000000 })).code).toBe("invalid_link");
  });

  it("gösterim talebi: yüksek öncelikli görev + danışmana bildirim; olmayan/yayında olmayan portföy reddedilir", async () => {
    const r = await call(TOKEN, "visit", { property_id: P, preferred: "Cumartesi öğleden sonra" });
    expect(r).toMatchObject({ ok: true, code: "ok" });
    const t = (await q(`select title, kind, priority, assigned_to, notes from public.tasks where title = 'Portaldan gösterim talebi'`))[0]!;
    expect(t).toMatchObject({ kind: "visit", priority: "high", assigned_to: ADV });
    expect(String(t.notes)).toContain("Cumartesi");
    expect((await q(`select user_id from public.notifications where title = 'Portaldan gösterim talebi'`))[0]!.user_id).toBe(ADV);
    expect((await call(TOKEN, "visit", { property_id: P })).code).toBe("duplicate");
    const draft = (await q(`insert into public.properties(tenant_id, property_code, status) values ($1, 'X-1', 'draft') returning id`, [T]))[0]!.id as string;
    expect((await call(TOKEN, "visit", { property_id: draft })).code).toBe("not_found");
  });

  it("arayış güncelleme: talep DEĞİŞMEZ, bekleyen istek yazılır; ikinci istek aynı satırı günceller; başkasının talebi reddedilir", async () => {
    expect((await call(TOKEN, "demand_update", { demand_id: DEM2, budget_max: 9000000 })).code).toBe("not_found");
    expect((await call(TOKEN, "demand_update", { demand_id: DEM })).code).toBe("nothing_to_update");
    expect((await call(TOKEN, "demand_update", { demand_id: DEM, budget_min: 9000000, budget_max: 1000000 })).code).toBe("invalid_amount");
    expect((await call(TOKEN, "demand_update", { demand_id: DEM, budget_max: 8500000, rooms: "3+1", area: "Kadıköy", note: "Bütçem arttı" })).ok).toBe(true);
    const d = (await q(`select budget_max::text, rooms from public.customer_demands where id = $1`, [DEM]))[0]!;
    expect(d).toMatchObject({ budget_max: "7000000", rooms: "2+1" });
    const u = (await q(`select status, budget_max::text, rooms, area_text from public.portal_demand_updates`));
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ status: "pending", budget_max: "8500000.00", rooms: "3+1", area_text: "Kadıköy" });
    expect(await count("tasks", "title = 'Arayış güncelleme isteği'")).toBe(1);
  });

  it("kiracı Ödedim: bildirim teyit bekler, tahakkuk paid OLMAZ; ödenmiş/başkasının tahakkuku ve fazla tutar reddedilir", async () => {
    expect((await call(TOKEN, "rent_paid", { charge_id: CH2 })).code).toBe("not_found");
    expect((await call(TOKEN, "rent_paid", { charge_id: CH, amount: 99999 })).code).toBe("invalid_amount");
    expect((await call(TOKEN, "rent_paid", { charge_id: CH, reference: "Dekont 4471", note: "EFT yaptım" })).ok).toBe(true);
    const n = (await q(`select status, amount::text, reference from public.rent_payment_notices`))[0]!;
    expect(n).toMatchObject({ status: "pending", amount: "25000.00", reference: "Dekont 4471" });
    expect((await q(`select status from public.rent_charges where id = $1`, [CH]))[0]!.status).toBe("pending");
    expect((await q(`select user_id from public.notifications where title = 'Kiracı kirayı ödediğini bildirdi'`))[0]!.user_id).toBe(ADV);
    // Aynı tahakkukta ikinci bildirim yazılmaz.
    expect((await call(TOKEN, "rent_paid", { charge_id: CH })).code).toBe("duplicate");
    expect(await count("rent_payment_notices")).toBe(1);
  });

  it("günlük tavan 10 istek; rollback v1 gövdesine döner, yeni tablolar düşer, iş kayıtları kalır", async () => {
    const used = await count("portal_customer_requests", `customer_id = '${C}'`);
    for (let i = used; i < 10; i++) await q(`insert into public.portal_customer_requests(tenant_id, customer_id, kind, ref_id) values ($1,$2,'offer', gen_random_uuid())`, [T, C]);
    expect((await call(TOKEN, "visit", { property_id: P })).code).toMatch(/rate_limited|duplicate/);
    await q(`update public.portal_customer_requests set created_at = now() - interval '1 hour' where kind = 'visit'`);
    expect((await call(TOKEN, "rent_paid", { charge_id: CH })).code).toBe("rate_limited");
    await db.exec(read("supabase/rollbacks/20261012000200_portal_requests_v2.rollback.sql"));
    expect(await count("tasks")).toBeGreaterThan(0);
    await expect(q(`select 1 from public.rent_payment_notices`)).rejects.toThrow();
    // v1 RPC yeni türleri tanımaz.
    expect((await call(TOKEN, "visit", { property_id: P })).code).toBe("invalid_request");
  });
});
