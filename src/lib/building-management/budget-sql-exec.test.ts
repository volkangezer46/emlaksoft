import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261020030033_building_budget_announcements — işletme projesi RPC'leri (yetki içeride, kalem doğrulama,
 * dönem tekilliği, onay kilidi), aylık avans tahakkuku (mevcut create_building_batch ile, budget_id bağı, idempotent, hata olursa hiçbir ay
 * yazılmaz), taslağa alma koruması, duyuru RLS'i (sütun bazlı güncelleme, ofis izolasyonu) ve rollback.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.geo_provinces(id uuid primary key default gen_random_uuid(), name text);
create table public.geo_districts(id uuid primary key default gen_random_uuid(), province_id uuid references public.geo_provinces(id), name text);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text);
create unique index idx_customers_id_tenant_unique on public.customers(id, tenant_id);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create unique index idx_properties_id_tenant_unique on public.properties(id, tenant_id);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, due_day integer not null default 5);
create unique index idx_rentals_id_tenant_unique on public.rentals(id, tenant_id);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null references public.rentals(id),
  period date not null, amount numeric(14,2) not null, status text not null default 'pending' check (status in ('pending','paid','overdue')),
  paid_at timestamptz, created_at timestamptz not null default now());
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, title text, amount numeric, currency text default 'TRY', expense_date date);
create table public.property_dues(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, title text, amount numeric, period date);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("building_budget_announcements (pglite)", () => {
  let db: Db;
  let T: string, T2: string, U: string, U2: string, B: string, U1: string, U2u: string, U3: string, BUDGET: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','owner',false)`);
    await db.exec(`set role authenticated`);
  };
  const ALL = "expenses:view expenses:create expenses:edit expenses:delete";
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const save = (id: string | null, building: string, start: string, months: number, lines: unknown, dist = "land_share", title = "2027 işletme projesi") =>
    rpc(`public.save_building_budget($1::uuid, $2::uuid, $3, $4::date, $5::int, $6, $7::jsonb, null, null, null)`, [id, building, title, start, months, dist, JSON.stringify(lines)]);
  const status = (id: string, action: string) => rpc(`public.set_building_budget_status($1::uuid, $2)`, [id, action]);
  const accrue = (id: string, periods: string[], shares: { unit_id: string; amount: number }[]) =>
    rpc(`public.accrue_building_budget($1::uuid, $2::jsonb, $3::jsonb)`, [id, JSON.stringify(periods), JSON.stringify(shares)]);
  const LINES = [{ category: "Temizlik", label: "Ortak alan temizliği", amount: 24000 }, { category: "Asansör", label: "Asansör bakımı", amount: 12000 }];

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    U = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    U2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261008001100_property_management_core.sql"));
    await db.exec(read("supabase/migrations/20261008001700_building_management.sql"));
    await db.exec(read("supabase/migrations/20261020030033_building_budget_announcements.sql"));
    B = (await q(`insert into public.buildings(tenant_id, name, due_day) values ($1,'Güneş Apt.',10) returning id`, [T]))[0]!.id as string;
    U1 = (await q(`insert into public.building_units(tenant_id, building_id, unit_no, land_share) values ($1,$2,'1',10) returning id`, [T, B]))[0]!.id as string;
    U2u = (await q(`insert into public.building_units(tenant_id, building_id, unit_no, land_share) values ($1,$2,'2',10) returning id`, [T, B]))[0]!.id as string;
    U3 = (await q(`insert into public.building_units(tenant_id, building_id, unit_no, land_share) values ($1,$2,'3',20) returning id`, [T, B]))[0]!.id as string;
  });

  it("taslak kaydet: yetki içeride, kalemler doğrulanır, toplam sunucuda hesaplanır, dönem tekil", async () => {
    await as(U, T, "expenses:view");
    expect((await save(null, B, "2027-01-01", 12, LINES)).outcome).toBe("forbidden");
    await as(U, T, ALL);
    expect((await save(null, B, "2027-01-15", 12, LINES)).outcome).toBe("invalid_input");
    expect((await save(null, B, "2027-01-01", 12, LINES, "fixed")).outcome).toBe("invalid_input");
    expect((await save(null, B, "2027-01-01", 12, [{ label: "", amount: 10 }])).outcome).toBe("invalid_lines");
    expect((await save(null, B, "2027-01-01", 12, [{ label: "x", amount: 10.001 }])).outcome).toBe("invalid_lines");
    const ok = await save(null, B, "2027-01-01", 12, LINES);
    expect(ok.outcome).toBe("saved");
    BUDGET = ok.budget_id as string;
    expect(Number(ok.total)).toBe(36000);
    expect((await save(null, B, "2027-01-01", 12, LINES)).outcome).toBe("duplicate_period");
    // istemci doğrudan yazamaz
    await expect(db.query(`update public.building_budgets set total_amount = 1 where id = '${BUDGET}'`)).rejects.toThrow();
    // başka ofis göremez
    await as(U2, T2, ALL);
    expect(await q(`select id from public.building_budgets`)).toHaveLength(0);
    expect((await status(BUDGET, "approve")).outcome).toBe("not_found");
  });

  it("onay: kalemler kilitlenir; avans tahakkuku onaysız açılmaz", async () => {
    await as(U, T, ALL);
    expect((await accrue(BUDGET, ["2027-01-01"], [{ unit_id: U1, amount: 3000 }])).outcome).toBe("not_approved");
    expect((await status(BUDGET, "approve")).outcome).toBe("done");
    expect((await save(BUDGET, B, "2027-01-01", 12, LINES)).outcome).toBe("locked");
    expect((await status(BUDGET, "delete")).outcome).toBe("locked");
  });

  it("aylık avans: create_building_batch ile tahakkuk, budget_id bağı, tekrar güvenli, pencere dışı reddedilir", async () => {
    await as(U, T, ALL);
    // aylık 3000: arsa payı 10/10/20 → 750 / 750 / 1500
    const shares = [{ unit_id: U1, amount: 750 }, { unit_id: U2u, amount: 750 }, { unit_id: U3, amount: 1500 }];
    expect((await accrue(BUDGET, ["2028-01-01"], shares)).outcome).toBe("invalid_periods");
    expect((await accrue(BUDGET, ["2027-01-01", "2027-01-01"], shares)).outcome).toBe("invalid_periods");
    // toplam uyuşmazsa HİÇBİR ay yazılmaz
    expect((await accrue(BUDGET, ["2027-01-01", "2027-02-01"], [{ unit_id: U1, amount: 1000 }])).outcome).toBe("sum_mismatch");
    await db.exec(`reset role`);
    expect((await q(`select count(*)::int as n from public.building_charge_batches where building_id = $1`, [B]))[0]!.n).toBe(0);
    // elle açılmış Mart aidatı: atlanır
    await as(U, T, ALL);
    expect((await rpc(`public.create_building_batch($1::uuid, 'aidat', '2027-03-01'::date, 'Mart', null, 3000::numeric, 'land_share', '2027-03-10'::date, $2::jsonb)`, [B, JSON.stringify(shares)])).outcome).toBe("created");
    const res = await accrue(BUDGET, ["2027-01-01", "2027-02-01", "2027-03-01"], shares);
    expect(res).toMatchObject({ outcome: "accrued", created: 2, skipped: 1 });
    await db.exec(`reset role`);
    const linked = await q(`select period::text as p, due_date::text as d, total_amount::float8 as t, category from public.building_charge_batches where budget_id = $1 order by period`, [BUDGET]);
    expect(linked).toEqual([
      { p: "2027-01-01", d: "2027-01-10", t: 3000, category: "İşletme projesi" },
      { p: "2027-02-01", d: "2027-02-10", t: 3000, category: "İşletme projesi" },
    ]);
    expect((await q(`select count(*)::int as n from public.building_charges c join public.building_charge_batches b on b.id = c.batch_id where b.budget_id = $1`, [BUDGET]))[0]!.n).toBe(6);
    await as(U, T, ALL);
    expect(await accrue(BUDGET, ["2027-01-01"], shares)).toMatchObject({ outcome: "accrued", created: 0, skipped: 1 });
    await as(U, T, "expenses:view expenses:edit");
    expect((await accrue(BUDGET, ["2027-04-01"], shares)).outcome).toBe("forbidden");
  });

  it("taslağa alma: avans varken reddedilir, avanslar iptal edilince açılır", async () => {
    await as(U, T, ALL);
    expect((await status(BUDGET, "reopen")).outcome).toBe("has_accruals");
    await db.exec(`reset role`);
    const ids = (await q(`select id from public.building_charge_batches where budget_id = $1`, [BUDGET])).map((r) => r.id as string);
    await as(U, T, ALL);
    for (const id of ids) expect((await rpc(`public.void_building_batch($1::uuid, 'test iptali')`, [id])).outcome).toBe("voided");
    expect((await status(BUDGET, "reopen")).outcome).toBe("done");
    expect((await save(BUDGET, B, "2027-01-01", 12, [{ label: "Tek kalem", amount: 1200 }])).outcome).toBe("saved");
    expect((await status(BUDGET, "delete")).outcome).toBe("done");
  });

  it("duyurular: kendi ofisine eklenir, yalnız izinli sütunlar güncellenir, başka ofis göremez", async () => {
    await as(U, T, "expenses:view");
    await expect(db.query(`insert into public.building_announcements(tenant_id, building_id, title, body, created_by) values ('${T}','${B}','x','y','${U}')`)).rejects.toThrow();
    await as(U, T, ALL);
    await expect(db.query(`insert into public.building_announcements(tenant_id, building_id, title, body, created_by) values ('${T}','${B}','x','y','${U2}')`)).rejects.toThrow();
    const id = (await q(`insert into public.building_announcements(tenant_id, building_id, title, body, category, created_by) values ($1,$2,'Su kesintisi','Salı 10-14',$3,$4) returning id`, [T, B, "kesinti", U]))[0]!.id as string;
    await db.exec(`update public.building_announcements set pinned = true, delivery = '{"sms":{"sent":3}}'::jsonb where id = '${id}'`);
    await expect(db.query(`update public.building_announcements set title = 'değişti' where id = '${id}'`)).rejects.toThrow();
    // koşullu talep deseni: delivery->sms doluyken eşleşmez
    expect(await q(`update public.building_announcements set delivery = '{}'::jsonb where id = $1 and delivery->'sms' is null returning id`, [id])).toHaveLength(0);
    await as(U2, T2, ALL);
    expect(await q(`select id from public.building_announcements`)).toHaveLength(0);
  });

  it("rollback: tablolar, RPC'ler ve budget_id düşer; tahakkuklar kalır", async () => {
    await db.exec(`reset role`);
    const before = (await q(`select count(*)::int as n from public.building_charge_batches`))[0]!.n as number;
    await db.exec(read("supabase/rollbacks/20261020030033_building_budget_announcements.rollback.sql"));
    expect((await q(`select to_regclass('public.building_budgets') as t`))[0]!.t).toBeNull();
    expect((await q(`select to_regclass('public.building_announcements') as t`))[0]!.t).toBeNull();
    expect((await q(`select to_regprocedure('public.accrue_building_budget(uuid,jsonb,jsonb)') as f`))[0]!.f).toBeNull();
    expect(await q(`select 1 from information_schema.columns where table_name = 'building_charge_batches' and column_name = 'budget_id'`)).toHaveLength(0);
    expect((await q(`select count(*)::int as n from public.building_charge_batches`))[0]!.n).toBe(before);
  });
});
