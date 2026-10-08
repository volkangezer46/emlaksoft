import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261008001100_property_management_core — RPC yetkisi içeride, kısmi ödeme/durum türetme,
 * fazla ödeme reddi, sıralı makbuz (ofis başına), yönetim ücreti (yüzde/sabit), iptal, ödeme günü, RLS (başka ofis göremez,
 * rentals:edit olmayan mülk sahibi finansını göremez), eski "ödendi" kayıtlar için geri doldurma, rollback.
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
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid);
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

describe.skipIf(!mod)("property_management_core (pglite)", () => {
  let db: Db;
  let T: string, T2: string, U: string, U2: string, P: string, R: string, R2: string, C1: string, C2: string, C3: string, LEG: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role = "owner") => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const pay = async (charge: string, amount: number, paidOn = "2026-10-06", method = "cash") =>
    (await q(`select public.record_rent_payment($1::uuid, $2::numeric, $3::date, $4::text, null) as r`, [charge, amount, paidOn, method]))[0]!.r as Record<string, unknown>;
  const status = async (id: string) => (await q(`select status, paid_amount::float8 as paid from public.rent_charges where id = $1`, [id]))[0] as { status: string; paid: number };
  const EDIT = "rentals:view rentals:edit rentals:delete";

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    U = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    U2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    P = (await q(`insert into public.properties(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    R = (await q(`insert into public.rentals(tenant_id, property_id, due_day) values ($1,$2,5) returning id`, [T, P]))[0]!.id as string;
    R2 = (await q(`insert into public.rentals(tenant_id, due_day) values ($1,5) returning id`, [T2]))[0]!.id as string;
    // Eski 'ödendi' tahakkuk (geri doldurma testi) migration'dan ÖNCE vardır.
    LEG = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount, status, paid_at) values ($1,$2,'2026-01-01',5000,'paid','2026-01-06T09:00:00Z') returning id`, [T, R]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261008001100_property_management_core.sql"));
    C1 = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-10-01',10000) returning id`, [T, R]))[0]!.id as string;
    C2 = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-11-01',10000) returning id`, [T, R]))[0]!.id as string;
    C3 = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-10-01',3000) returning id`, [T2, R2]))[0]!.id as string;
  });

  it("eski ödendi tahakkuk için legacy tahsilat + paid_amount + makbuz sırası dolduruldu", async () => {
    const rows = await q(`select legacy, receipt_no, amount::float8 as amount from public.rent_payments where charge_id = $1`, [LEG]);
    expect(rows).toEqual([{ legacy: true, receipt_no: 1, amount: 5000 }]);
    expect((await status(LEG)).paid).toBe(5000);
  });

  it("oturum/izin yoksa yazmaz", async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('test.tenant','',false)`);
    expect((await pay(C1, 100)).outcome).toBe("unauthorized");
    await as(U, T, "rentals:view");
    expect((await pay(C1, 100)).outcome).toBe("forbidden");
  });

  it("kısmi ödeme -> kısmi, kalan ödenince ödendi; makbuz sıralı; fazla ödeme reddedilir", async () => {
    await as(U, T, EDIT);
    const a = await pay(C1, 4000, "2026-10-06", "bank_transfer");
    expect(a).toMatchObject({ outcome: "recorded", receipt_no: 2, charge_status: "partial", paid_amount: 4000 });
    expect((await pay(C1, 7000)).outcome).toBe("overpayment");
    const b = await pay(C1, 6000);
    expect(b).toMatchObject({ outcome: "recorded", receipt_no: 3, charge_status: "paid" });
    expect((await pay(C1, 1)).outcome).toBe("already_paid");
    expect((await pay(C2, 0)).outcome).toBe("invalid_input");
    expect((await pay(C2, 100, "2999-01-01")).outcome).toBe("invalid_input");
    expect((await pay(C2, 100, "2026-10-06", "bitcoin")).outcome).toBe("invalid_input");
  });

  it("yönetim ücreti: yüzde anlık kopyalanır, sabit tahakkuk başına bir kez", async () => {
    await as(U, T, EDIT);
    await db.exec(`reset role`);
    await db.exec(`insert into public.rental_management_agreements(tenant_id, rental_id, fee_type, fee_value) values ('${T}','${R}','percent',8)`);
    await as(U, T, EDIT);
    const p = await pay(C2, 2500.55);
    expect(p.management_fee).toBe(200.04); // 2500,55 x %8 = 200,044
    await db.exec(`reset role; update public.rental_management_agreements set fee_type='fixed', fee_value=1500 where rental_id='${R}'`);
    await as(U, T, EDIT);
    const c4 = (await q(`select 1`)); void c4;
    await db.exec(`reset role`);
    const C4 = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-12-01',9000) returning id`, [T, R]))[0]!.id as string;
    await as(U, T, EDIT);
    expect((await pay(C4, 1000)).management_fee).toBe(1000);
    expect((await pay(C4, 5000)).management_fee).toBe(500);
    expect((await pay(C4, 3000)).management_fee).toBe(0);
    expect((await status(C4)).status).toBe("paid");
  });

  it("iptal: neden zorunlu, yetki delete, durum yeniden türetilir, ücret yeniden dağıtılır, çift iptal reddedilir", async () => {
    await as(U, T, EDIT);
    const first = (await q(`select id from public.rent_payments where charge_id = $1 and amount = 4000`, [C1]))[0]!.id as string;
    await as(U, T, "rentals:view rentals:edit");
    expect((await q(`select public.void_rent_payment($1::uuid, 'yanlis giris') as r`, [first]))[0]!.r).toMatchObject({ outcome: "forbidden" });
    await as(U, T, EDIT);
    expect((await q(`select public.void_rent_payment($1::uuid, 'x') as r`, [first]))[0]!.r).toMatchObject({ outcome: "invalid_input" });
    expect((await q(`select public.void_rent_payment($1::uuid, 'yanlis giris') as r`, [first]))[0]!.r).toMatchObject({ outcome: "voided", charge_status: "partial", paid_amount: 6000 });
    expect((await q(`select public.void_rent_payment($1::uuid, 'yanlis giris') as r`, [first]))[0]!.r).toMatchObject({ outcome: "already_voided" });
    const audit = await q(`select action from public.audit_logs where action like 'rent_payment.%' order by action`);
    expect(audit.map((a) => a.action)).toContain("rent_payment.void");
  });

  it("makbuz numarası ofis başına bağımsız", async () => {
    await as(U2, T2, EDIT);
    expect((await pay(C3, 1000)).receipt_no).toBe(1);
  });

  it("başka ofisin tahakkukuna dokunulamaz", async () => {
    await as(U, T, EDIT);
    expect((await pay(C3, 100)).outcome).toBe("not_found");
  });

  it("RLS: başka ofis göremez; rentals:view mülk sahibi finansını göremez", async () => {
    await as(U2, T2, EDIT);
    expect((await q(`select count(*)::int as n from public.rent_payments where tenant_id = $1`, [T]))[0]!.n).toBe(0);
    await db.exec(`reset role; insert into public.rental_management_agreements(tenant_id, rental_id) values ('${T2}','${R2}')`);
    await as(U, T, "rentals:view");
    expect((await q(`select count(*)::int as n from public.rent_payments`))[0]!.n).toBeGreaterThan(0);
    expect((await q(`select count(*)::int as n from public.rental_management_agreements`))[0]!.n).toBe(0);
    await as(U, T, EDIT);
    expect((await q(`select count(*)::int as n from public.rental_management_agreements where tenant_id = $1`, [T2]))[0]!.n).toBe(0);
  });

  it("istemci doğrudan tahsilat/ödeme yazamaz; sayaca erişemez", async () => {
    await as(U, T, EDIT);
    await expect(db.query(`insert into public.rent_payments(tenant_id, rental_id, charge_id, amount, paid_on, method, receipt_no) values ('${T}','${R}','${C2}',1,'2026-10-01','cash',999)`)).rejects.toThrow();
    await expect(db.query(`select * from public.rent_receipt_counters`)).rejects.toThrow();
    await expect(db.query(`insert into public.owner_payouts(tenant_id, rental_id, amount, paid_on, method) values ('${T}','${R}',1,'2026-10-01','cash')`)).rejects.toThrow();
  });

  it("IBAN biçim kısıtı; ücret aralığı", async () => {
    await db.exec(`reset role`);
    await expect(db.query(`update public.rental_management_agreements set owner_iban = 'TR12' where rental_id = '${R}'`)).rejects.toThrow();
    await expect(db.query(`update public.rental_management_agreements set fee_type='percent', fee_value=101 where rental_id = '${R}'`)).rejects.toThrow();
  });

  it("mülk sahibi ödemesi: yönetilmeyen kirada reddedilir, kayıt + iptal + denetim", async () => {
    await as(U, T, EDIT);
    expect((await q(`select public.record_owner_payout($1::uuid, 500, '2026-10-07', 'bank_transfer', 'DKN-1', null) as r`, [R]))[0]!.r).toMatchObject({ outcome: "recorded" });
    const id = (await q(`select id from public.owner_payouts where rental_id = $1`, [R]))[0]!.id as string;
    expect((await q(`select public.record_owner_payout($1::uuid, 500, '2026-10-07', 'card', null, null) as r`, [R]))[0]!.r).toMatchObject({ outcome: "invalid_input" });
    expect((await q(`select public.void_owner_payout($1::uuid, 'hatali tutar') as r`, [id]))[0]!.r).toMatchObject({ outcome: "voided" });
    await as(U, T, EDIT);
    const unmanaged = (await q(`select public.record_owner_payout($1::uuid, 500, '2026-10-07', 'cash', null, null) as r`, [R2]))[0]!.r;
    expect(unmanaged).toMatchObject({ outcome: "not_managed" });
    const actions = (await q(`select action from public.audit_logs where action like 'owner_payout.%'`)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["owner_payout.record", "owner_payout.void"]));
  });

  it("gider yansıtma: yalnız aynı portföyün kalemi, tekil", async () => {
    await db.exec(`reset role`);
    const E = (await q(`insert into public.expenses(tenant_id, property_id, title, amount, expense_date) values ($1,$2,'Tesisat',800,'2026-10-02') returning id`, [T, P]))[0]!.id as string;
    const EX = (await q(`insert into public.expenses(tenant_id, property_id, title, amount, expense_date) values ($1,null,'Genel',50,'2026-10-02') returning id`, [T]))[0]!.id as string;
    await as(U, T, EDIT);
    await db.exec(`insert into public.owner_charge_links(tenant_id, rental_id, kind, ref_id, amount, entry_date, label) values ('${T}','${R}','expense','${E}',800,'2026-10-02','Tesisat')`);
    await expect(db.query(`insert into public.owner_charge_links(tenant_id, rental_id, kind, ref_id, amount, entry_date, label) values ('${T}','${R}','expense','${E}',800,'2026-10-02','Tesisat')`)).rejects.toThrow();
    await expect(db.query(`insert into public.owner_charge_links(tenant_id, rental_id, kind, ref_id, amount, entry_date, label) values ('${T}','${R}','expense','${EX}',50,'2026-10-02','Genel')`)).rejects.toThrow();
  });

  it("rollback: fonksiyonlar ve tablolar düşer, durum CHECK eski haline döner", async () => {
    await db.exec(`reset role`);
    await db.exec(`update public.rent_charges set status='pending' where status='partial'`);
    await db.exec(read("supabase/rollbacks/20261008001100_property_management_core.rollback.sql"));
    expect((await q(`select to_regclass('public.rent_payments') as t`))[0]!.t).toBeNull();
    await expect(db.query(`insert into public.rent_charges(tenant_id, rental_id, period, amount, status) values ('${T}','${R}','2027-01-01',1,'partial')`)).rejects.toThrow();
  });
});
