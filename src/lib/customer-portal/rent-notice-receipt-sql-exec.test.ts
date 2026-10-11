import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012000900 rent_notice_receipt — token çözücü RPC (oturumsuz): geçersiz/süresi dolmuş token,
 * başka kiracının tahakkuku, bekleyen bildirim yokken; dekont yolu CHECK'i ofis/kiracı/bildirim biçimini zorlar.
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

describe.skipIf(!mod)("kira dekontu token çözücü (pglite)", () => {
  let db: Db;
  const TOKEN = "c".repeat(64);
  const TOKEN2 = "e".repeat(64);
  const EXPIRED = "d".repeat(64);
  let T: string, C: string, C2: string, CH: string, CH_NONOTICE: string, NOTICE: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const target = async (token: string, charge: string) =>
    (await q(`select public.portal_rent_receipt_target($1, $2) as r`, [token, charge]))[0]!.r as Record<string, unknown>;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    C = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Zeynep Kaya') returning id`, [T]))[0]!.id as string;
    C2 = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Başka Kiracı') returning id`, [T]))[0]!.id as string;
    await q(
      `insert into public.customer_portal_tokens(tenant_id, customer_id, token, expires_at) values ($1,$2,$3, now() + interval '1 day'), ($1,$4,$5, now() + interval '1 day'), ($1,$2,$6, now() - interval '1 day')`,
      [T, C, TOKEN, C2, TOKEN2, EXPIRED],
    );
    const P = (await q(`insert into public.properties(tenant_id, property_code, title, status) values ($1, 'KDK-12', 'Kadıköy 3+1', 'live') returning id`, [T]))[0]!.id as string;
    const RENT = (await q(`insert into public.rentals(tenant_id, property_id, renter_customer_id) values ($1,$2,$3) returning id`, [T, P, C]))[0]!.id as string;
    CH = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-10-01', 25000) returning id`, [T, RENT]))[0]!.id as string;
    CH_NONOTICE = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-11-01', 25000) returning id`, [T, RENT]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261007000620_customer_portal_requests.sql"));
    await db.exec(read("supabase/migrations/20261012000200_portal_requests_v2.sql"));
    await db.exec(read("supabase/migrations/20261012000900_rent_notice_receipt.sql"));
    const r = (await q(`select public.portal_customer_request($1, 'rent_paid', $2::jsonb) as r`, [TOKEN, JSON.stringify({ charge_id: CH })]))[0]!.r as { ok: boolean };
    expect(r.ok).toBe(true);
    NOTICE = (await q(`select id from public.rent_payment_notices`))[0]!.id as string;
  });

  it("geçersiz biçim / süresi dolmuş token reddedilir", async () => {
    expect((await target("kisa", CH)).code).toBe("invalid_link");
    expect((await target(EXPIRED, CH)).code).toBe("invalid_link");
  });

  it("başka kiracının tahakkuku ve bildirimsiz tahakkuk bulunamaz", async () => {
    expect((await target(TOKEN2, CH)).code).toBe("not_found");
    expect((await target(TOKEN, CH_NONOTICE)).code).toBe("not_found");
  });

  it("sahibi için ofis, kiracı ve bildirim kimliğini döndürür", async () => {
    expect(await target(TOKEN, CH)).toMatchObject({ ok: true, tenant_id: T, customer_id: C, notice_id: NOTICE, receipt_status: null });
  });

  it("dekont yolu CHECK'i: yalnız ofis/kiracı/bildirim/dosya biçimi ve jpg/png/pdf, <= 5 MB", async () => {
    const good = `${T}/${C}/${NOTICE}/${"a".repeat(8)}-aaaa-aaaa-aaaa-${"a".repeat(12)}.pdf`;
    const set = (path: string, mime: string, size: number) =>
      db.query(
        `update public.rent_payment_notices set receipt_path=$1, receipt_name='d.pdf', receipt_mime=$2, receipt_size=$3, receipt_status='pending' where id=$4`,
        [path, mime, size, NOTICE],
      );
    await expect(set("../x.pdf", "application/pdf", 10)).rejects.toThrow();
    await expect(set(good.replace(".pdf", ".exe"), "application/pdf", 10)).rejects.toThrow();
    await expect(set(good, "text/html", 10)).rejects.toThrow();
    await expect(set(good, "application/pdf", 5242881)).rejects.toThrow();
    await set(good, "application/pdf", 5242880);
    expect((await target(TOKEN, CH)).receipt_status).toBe("pending");
  });
});
