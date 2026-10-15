import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012001300 — rent_charges finansal sütun kapısı (GUVENLIK-2).
 * Gerçek migration dosyaları (20261008001100 tahsilat RPC'leri + 20261012001300 tetikleyicileri) küçük Supabase taklidi
 * üzerinde koşar. Senaryolar: sube muduru (rentals:edit, authenticated) PostgREST'e eş doğrudan PATCH ile paid_amount/status/
 * amount/paid_at/rental_id/tenant_id değiştiremez (42501); finansal olmayan güncelleme serbest; record/void RPC'leri çalışmaya
 * devam eder (DEFINER); service_role/cron etkilenmez; tahsilat kaydı olan tahakkuk silinemez (iptal edilmiş dahil), ödemesiz ve
 * örnek kira tahakkuku silinebilir; rollback.
 * SK1/B177: dönem ve tahsilat tarihleri SABİT DEĞİL, pglite saatine (İstanbul) göre üretilir: RPC'nin now()'a göre gecikme
 * kuralı (vade + 7 gün) belirli bir günde testi kendiliğinden kırmaz. Gece +30/+60/+365 gün kaydırmalı koşar.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
grant usage on schema auth to authenticated, anon, service_role;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid, due_day integer not null default 5,
  is_sample boolean not null default false);
create unique index idx_rentals_id_tenant_unique on public.rentals(id, tenant_id);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null references public.rentals(id) on delete cascade,
  period date not null, amount numeric(14,2) not null, status text not null default 'pending' check (status in ('pending','paid','overdue')),
  paid_at timestamptz, created_at timestamptz not null default now());
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, title text, amount numeric, currency text default 'TRY', expense_date date);
create table public.property_dues(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, title text, amount numeric, period date);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.rent_charges to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("rent_charges finansal sütun kapısı (pglite)", () => {
  let db: Db;
  let T: string, T2: string, BM: string, P: string, R: string, RS: string;
  let C1: string, C2: string, C3: string, CS: string;
  /** Bugün (İstanbul, pglite saati) ve ay başı + n ay; beforeAll'da doldurulur. */
  let TODAY = "";
  const months: Record<number, string> = {};
  const M = (n: number) => months[n]!;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const admin = async () =>
    db.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)`);
  /** PostgREST'in authenticated rolü (sube muduru: rentals:edit/delete; muhasebe değil). */
  const asBm = async (perms = "rentals:view rentals:edit rentals:delete") => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${BM}',false), set_config('request.jwt.claim.role','authenticated',false),
      set_config('test.tenant','${T}',false), set_config('test.perms','${perms}',false), set_config('test.role','branch_manager',false)`);
    await db.exec(`set role authenticated`);
  };
  const pay = async (charge: string, amount: number) =>
    (await q(`select public.record_rent_payment($1::uuid, $2::numeric, $3::date, 'cash', null) as r`, [charge, amount, TODAY]))[0]!.r as Record<string, unknown>;
  const charge = async (id: string) =>
    (await q(`select status, paid_amount::float8 as paid, amount::float8 as amount, paid_at from public.rent_charges where id = $1`, [id]))[0] as
      | { status: string; paid: number; amount: number; paid_at: string | null }
      | undefined;
  const mkCharge = async (rental: string, period: string, amount = 10000, tenant = T) => {
    await admin();
    return (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,$3,$4) returning id`, [tenant, rental, period, amount]))[0]!.id as string;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    BM = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    P = (await q(`insert into public.properties(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    R = (await q(`insert into public.rentals(tenant_id, property_id) values ($1,$2) returning id`, [T, P]))[0]!.id as string;
    RS = (await q(`insert into public.rentals(tenant_id, property_id, is_sample) values ($1,$2,true) returning id`, [T, P]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261008001100_property_management_core.sql"));
    await db.exec(read("supabase/migrations/20261012001300_rent_charges_financial_guard.sql"));
    const clock = (await q(`select (now() at time zone 'Europe/Istanbul')::date::text as d,
      array(select (date_trunc('month', (now() at time zone 'Europe/Istanbul')) + (n || ' month')::interval)::date::text
              from generate_series(-1, 4) n order by n) as m`))[0]! as { d: string; m: string[] };
    TODAY = clock.d;
    clock.m.forEach((v, i) => (months[i - 1] = v));
    C1 = await mkCharge(R, M(0));
    // C2 gelecek ayın dönemi: vade + 7 gün bugünden sonra → kısmi tahsilat "partial" kalır (gecikme kuralına düşmez).
    C2 = await mkCharge(R, M(1));
    C3 = await mkCharge(R, M(2));
    CS = await mkCharge(RS, M(0));
  });

  it("şube müdürü doğrudan paid_amount/status/amount/paid_at/rental_id/tenant_id değiştiremez (42501), tahakkuk değişmez", async () => {
    const before = await charge(C1);
    await asBm();
    for (const set of [
      "paid_amount = 10000",
      "status = 'paid'",
      "status = 'paid', paid_amount = 10000, paid_at = now()",
      "amount = 1",
      "paid_at = now()",
      `rental_id = '${RS}'`,
      `tenant_id = '${T2}'`,
      `period = '${M(-1)}'`,
    ]) {
      await expect(q(`update public.rent_charges set ${set} where id = $1`, [C1]), set).rejects.toThrow(/dogrudan degistirilemez/);
    }
    await admin();
    expect(await charge(C1)).toEqual(before);
  });

  it("finansal olmayan güncelleme ve aynı değeri yeniden yazma serbest", async () => {
    await asBm();
    expect(await q(`update public.rent_charges set created_at = now() where id = $1 returning id`, [C1])).toHaveLength(1);
    expect(await q(`update public.rent_charges set status = status, amount = amount where id = $1 returning id`, [C1])).toHaveLength(1);
  });

  it("record_rent_payment ve void_rent_payment çalışmaya devam eder (DEFINER); durum RPC ile değişir", async () => {
    await asBm();
    expect(await pay(C2, 4000)).toMatchObject({ outcome: "recorded", charge_status: "partial", paid_amount: 4000 });
    expect(await pay(C2, 6000)).toMatchObject({ outcome: "recorded", charge_status: "paid" });
    await asBm();
    const first = (await q(`select id from public.rent_payments where charge_id = $1 and amount = 4000`, [C2]))[0]!.id as string;
    expect((await q(`select public.void_rent_payment($1::uuid, 'yanlis giris') as r`, [first]))[0]!.r).toMatchObject({ outcome: "voided", charge_status: "partial", paid_amount: 6000 });
    expect(await charge(C2)).toMatchObject({ status: "partial", paid: 6000 });
    // RPC sonrası da doğrudan PATCH hâlâ kapalı.
    await expect(q(`update public.rent_charges set paid_amount = 0, status = 'pending' where id = $1`, [C2])).rejects.toThrow(/dogrudan degistirilemez/);
    expect(await charge(C2)).toMatchObject({ status: "partial", paid: 6000 });
  });

  it("service_role / cron / migration bağlamı etkilenmez (cron overdue, seed amount)", async () => {
    await admin();
    expect(await q(`update public.rent_charges set status = 'overdue' where id = $1 returning id`, [C3])).toHaveLength(1);
    expect(await q(`update public.rent_charges set amount = 12345 where id = $1 returning id`, [C3])).toHaveLength(1);
    expect(await charge(C3)).toMatchObject({ status: "overdue", amount: 12345 });
  });

  it("tahsilat kaydı olan tahakkuk silinemez (iptal edilmiş tahsilat dahil); kayıtsız tahakkuk silinebilir", async () => {
    await asBm();
    await expect(q(`delete from public.rent_charges where id = $1`, [C2])).rejects.toThrow(/silinemez/);
    // Yalnız iptal edilmiş tahsilat da iz taşır: silinemez.
    const C4 = await mkCharge(R, M(3), 5000);
    await asBm();
    const p = (await pay(C4, 5000)).payment_id as string;
    expect((await q(`select public.void_rent_payment($1::uuid, 'hatali tahsilat') as r`, [p]))[0]!.r).toMatchObject({ outcome: "voided" });
    await expect(q(`delete from public.rent_charges where id = $1`, [C4])).rejects.toThrow(/silinemez/);
    await admin();
    expect((await q(`select count(*)::int as n from public.rent_payments where charge_id = $1`, [C4]))[0]!.n).toBe(1);
    // Tahsilatsız tahakkuk silinebilir.
    const C5 = await mkCharge(R, M(4), 5000);
    await asBm();
    expect(await q(`delete from public.rent_charges where id = $1 returning id`, [C5])).toHaveLength(1);
  });

  it("örnek (demo) kira tahakkuku tahsilatlı olsa da silinebilir (purge_tenant_sample_data korunur)", async () => {
    await asBm();
    expect(await pay(CS, 1000)).toMatchObject({ outcome: "recorded" });
    await asBm();
    expect(await q(`delete from public.rent_charges where id = $1 returning id`, [CS])).toHaveLength(1);
  });

  it("service_role tahsilatlı tahakkuku silebilir (ofis silme / bakım bağlamı)", async () => {
    await admin();
    expect(await q(`delete from public.rent_charges where id = $1 returning id`, [C2])).toHaveLength(1);
  });

  it("rollback: tetikleyiciler düşer, doğrudan PATCH yeniden mümkün; ileri tekrar uygulanabilir", async () => {
    await admin();
    await db.exec(read("supabase/rollbacks/20261012001300_rent_charges_financial_guard.rollback.sql"));
    expect(await q(`select tgname from pg_trigger where tgrelid = 'public.rent_charges'::regclass and tgname in ('trg_rent_charges_financial_guard','trg_rent_charges_delete_guard')`)).toHaveLength(0);
    await asBm();
    expect(await q(`update public.rent_charges set amount = 1 where id = $1 returning id`, [C1])).toHaveLength(1);
    await admin();
    await db.exec(read("supabase/migrations/20261012001300_rent_charges_financial_guard.sql"));
    await asBm();
    await expect(q(`update public.rent_charges set amount = 2 where id = $1`, [C1])).rejects.toThrow(/dogrudan degistirilemez/);
  });
});
