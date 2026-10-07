import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000710 import_rental_with_deal — yetki içeride (oturum tenant'ı + iki izin),
 * guard tetikleyicileri (authenticated doğrudan yazımı reddeder) geçilirken atomiklik, komisyon 0 / oran / verilen tutar,
 * aktif kira ve kapanmış anlaşma reddi, başka ofis kimliği, malik bağı, rol geri yüklemesi, rollback.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_active boolean not null default true);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text, customer_types text[],
  deleted_at timestamptz, updated_at timestamptz);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, status text, commission_rate numeric,
  deleted_at timestamptz, updated_at timestamptz, owner_customer_id uuid);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, customer_id uuid, deal_type text,
  stage text, deal_value numeric, probability numeric, assigned_to uuid, closure_active boolean not null default false, prev_property_status text);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid, deal_id uuid unique, gross_amount numeric not null,
  vat_amount numeric not null default 0, status text, splits jsonb);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, property_id uuid, renter_customer_id uuid,
  monthly_rent numeric, due_day integer, start_date date, end_date date, deposit numeric, notes text, status text, prev_property_status text, deal_id uuid);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, new_value jsonb);
create function public.guard_stub() returns trigger language plpgsql as $$
begin
  if auth.role() = 'authenticated' then raise exception 'atomic workflow required' using errcode = '42501'; end if;
  return new;
end $$;
create trigger g1 before insert on public.rentals for each row execute function public.guard_stub();
create trigger g2 before insert on public.commissions for each row execute function public.guard_stub();
create trigger g3 before insert on public.deals for each row execute function public.guard_stub();
`;

describe.skipIf(!mod)("import_rental_with_deal (pglite)", () => {
  let db: Db;
  let T: string, T2: string, U: string, P: string, P2: string, P3: string, R: string, O: string, FOREIGN: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string) =>
    db.exec(`select set_config('request.jwt.claim.sub','${uid}',false), set_config('request.jwt.claim.role','authenticated',false),
      set_config('test.tenant','${tenant}',false), set_config('test.perms','${perms}',false)`);
  const call = async (args: Record<string, unknown>) =>
    (await q(
      `select public.import_rental_with_deal($1::uuid, $2::uuid, $3::numeric, $4::int, $5::date, $6::date, $7::numeric, $8::numeric, $9::uuid) as r`,
      [args.property, args.renter, args.rent ?? 15000, args.due ?? 5, args.start ?? "2026-01-01", args.end ?? null, args.deposit ?? null, args.commission ?? null, args.owner ?? null],
    ))[0]!.r as { outcome: string; rental_id?: string; deal_id?: string };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261007000710_import_rental_with_deal.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    U = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    P = (await q(`insert into public.properties(tenant_id, status, commission_rate) values ($1, 'live', null) returning id`, [T]))[0]!.id as string;
    P2 = (await q(`insert into public.properties(tenant_id, status, commission_rate) values ($1, 'rented', 100) returning id`, [T]))[0]!.id as string;
    P3 = (await q(`insert into public.properties(tenant_id, status) values ($1, 'sold') returning id`, [T]))[0]!.id as string;
    FOREIGN = (await q(`insert into public.properties(tenant_id, status) values ($1, 'live') returning id`, [T2]))[0]!.id as string;
    R = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Kiracı Kişi') returning id`, [T]))[0]!.id as string;
    O = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Malik Kişi') returning id`, [T]))[0]!.id as string;
  });

  it("oturum/izin yoksa yazmaz", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub','',false), set_config('test.tenant','',false)`);
    expect((await call({ property: P, renter: R })).outcome).toBe("unauthorized");
    await as(U, T, "rentals:create");
    expect((await call({ property: P, renter: R })).outcome).toBe("forbidden");
  });

  it("doğrudan yazım guard'a takılır; RPC anlaşma + komisyon 0 + aktif kirayı tek seferde kurar ve rolü geri koyar", async () => {
    await as(U, T, "rentals:create commissions:create");
    await expect(q(`insert into public.rentals(tenant_id, property_id, renter_customer_id) values ($1,$2,$3)`, [T, P, R])).rejects.toThrow(/atomic/);
    const r = await call({ property: P, renter: R, owner: O, deposit: 30000 });
    expect(r.outcome).toBe("created");
    const deal = (await q(`select stage, closure_active, deal_type, assigned_to from public.deals where id = $1`, [r.deal_id]))[0]!;
    expect(deal).toMatchObject({ stage: "won", closure_active: true, deal_type: "rent", assigned_to: U });
    expect(Number((await q(`select gross_amount from public.commissions where deal_id = $1`, [r.deal_id]))[0]!.gross_amount)).toBe(0);
    expect((await q(`select status, deal_id from public.rentals where id = $1`, [r.rental_id]))[0]).toMatchObject({ status: "active", deal_id: r.deal_id });
    expect((await q(`select status, owner_customer_id from public.properties where id = $1`, [P]))[0]).toMatchObject({ status: "rented", owner_customer_id: O });
    expect((await q(`select customer_types from public.customers where id = $1`, [R]))[0]!.customer_types).toEqual(["Kiracı"]);
    expect((await q(`select action from public.audit_logs`))[0]!.action).toBe("rental.import");
    expect((await q(`select auth.role() as r`))[0]!.r).toBe("authenticated");
  });

  it("aktif kira, satılmış portföy ve başka ofis kaydı reddedilir", async () => {
    expect((await call({ property: P, renter: R })).outcome).toBe("property_active_rental");
    expect((await call({ property: P3, renter: R })).outcome).toBe("property_unavailable");
    expect((await call({ property: FOREIGN, renter: R })).outcome).toBe("property_not_found");
  });

  it("komisyon: verilmezse oran × kira; 'rented' durumdaki (kirasız) portföy aktarılabilir", async () => {
    const r = await call({ property: P2, renter: O, rent: 20000 });
    expect(r.outcome).toBe("created");
    expect(Number((await q(`select gross_amount from public.commissions where deal_id = $1`, [r.deal_id]))[0]!.gross_amount)).toBe(20000);
  });

  it("geçersiz girdi (vade günü, negatif komisyon) yazmaz; rollback fonksiyonu düşürür", async () => {
    const P4 = (await q(`insert into public.properties(tenant_id, status) values ($1, 'live') returning id`, [T]))[0]!.id as string;
    expect((await call({ property: P4, renter: R, due: 31 })).outcome).toBe("invalid_input");
    expect((await call({ property: P4, renter: R, commission: -1 })).outcome).toBe("invalid_input");
    await db.exec(read("supabase/rollbacks/20261007000710_import_rental_with_deal.rollback.sql"));
    await expect(call({ property: P4, renter: R })).rejects.toThrow();
  });
});
