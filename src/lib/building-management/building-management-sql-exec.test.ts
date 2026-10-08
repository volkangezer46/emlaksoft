import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261008001700_building_management — RPC yetkisi içeride, toplu tahakkuk doğrulaması (toplam / daire kümesi /
 * tekrar), dönem aidatı tekilliği, kısmi tahsilat + durum, fazla ödeme reddi, ortak makbuz sırası (kira ile aynı sayaç), yönetim ücreti
 * (yüzde / sabit), iptal, malikin borcunu kira hakedişinden mahsup (+ geri alma), ofis izolasyonu (RLS), istemci doğrudan yazamaz, KPI, rollback.
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

describe.skipIf(!mod)("building_management (pglite)", () => {
  let db: Db;
  let T: string, T2: string, U: string, U2: string, OWNER: string, RENTER: string, P: string, R: string, RC: string, B: string, B2: string;
  let U1: string, U2u: string, U3: string, OTHER_B_UNIT: string;
  let BATCH: string, C1: string, C2: string, C3: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role = "owner") => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const ALL = "expenses:view expenses:create expenses:edit expenses:delete";
  const ALL_RENT = `${ALL} rentals:view rentals:edit rentals:delete`;
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const batch = (b: string, kind: string, period: string, total: number, shares: { unit_id: string; amount: number }[], dist = "equal", title = "Ekim aidatı") =>
    rpc(`public.create_building_batch($1::uuid, $2, $3::date, $4, null, $5::numeric, $6, ($3::date + 4), $7::jsonb)`, [b, kind, period, title, total, dist, JSON.stringify(shares)]);
  const pay = (charge: string, amount: number, paidOn = "2026-10-06", method = "cash") =>
    rpc(`public.record_building_payment($1::uuid, $2::numeric, $3::date, $4::text, null)`, [charge, amount, paidOn, method]);
  const charge = async (id: string) => (await q(`select status, paid_amount::float8 as paid, voided_at from public.building_charges where id = $1`, [id]))[0] as { status: string; paid: number; voided_at: string | null };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    U = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    U2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    OWNER = (await q(`insert into public.customers(tenant_id, full_name) values ($1,'Malik Ali') returning id`, [T]))[0]!.id as string;
    RENTER = (await q(`insert into public.customers(tenant_id, full_name) values ($1,'Kiracı Veli') returning id`, [T]))[0]!.id as string;
    P = (await q(`insert into public.properties(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    R = (await q(`insert into public.rentals(tenant_id, property_id) values ($1,$2) returning id`, [T, P]))[0]!.id as string;
    RC = (await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1,$2,'2026-10-01',10000) returning id`, [T, R]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261008001100_property_management_core.sql"));
    await db.exec(read("supabase/migrations/20261008001700_building_management.sql"));
  });

  it("RLS: yetkisiz kullanıcı bina açamaz; yetkili kendi ofisine açar", async () => {
    await as(U, T, "expenses:view");
    await expect(db.query(`insert into public.buildings(tenant_id, name) values ('${T}','Yetkisiz')`)).rejects.toThrow();
    await as(U, T, ALL_RENT);
    B = (await q(`insert into public.buildings(tenant_id, name, managed_by_office, fee_type, fee_value, due_day) values ($1,'Güneş Apt.',true,'percent',10,5) returning id`, [T]))[0]!.id as string;
    B2 = (await q(`insert into public.buildings(tenant_id, name) values ($1,'Ay Sitesi') returning id`, [T]))[0]!.id as string;
    // başka ofis adına ekleme reddedilir
    await expect(db.query(`insert into public.buildings(tenant_id, name) values ('${T2}','Sızma')`)).rejects.toThrow();
    // aynı ad (büyük/küçük harf farkıyla) ikinci kez açılamaz
    await expect(db.query(`insert into public.buildings(tenant_id, name) values ('${T}','güneş apt.')`)).rejects.toThrow();
    const mk = async (b: string, no: string, extra = "") =>
      (await q(`insert into public.building_units(tenant_id, building_id, unit_no, area_m2, land_share ${extra ? ", " + extra.split("|")[0] : ""}) values ($1,$2,$3,100,10 ${extra ? ", " + extra.split("|")[1] : ""}) returning id`, [T, b, no]))[0]!.id as string;
    U1 = await mk(B, "1", `owner_customer_id, rental_id, property_id|'${OWNER}', '${R}', '${P}'`);
    U2u = await mk(B, "2", `owner_customer_id, tenant_customer_id, payer|'${OWNER}', '${RENTER}', 'tenant'`);
    U3 = await mk(B, "3");
    OTHER_B_UNIT = await mk(B2, "1");
    // aynı binada aynı daire numarası ikinci kez olmaz
    await expect(db.query(`insert into public.building_units(tenant_id, building_id, unit_no) values ('${T}','${B}','1')`)).rejects.toThrow();
    // başka ofisin müşterisi daireye bağlanamaz (bileşik FK)
    await db.exec(`reset role`);
    const foreign = (await q(`insert into public.customers(tenant_id, full_name) values ($1,'Yabancı') returning id`, [T2]))[0]!.id as string;
    await as(U, T, ALL_RENT);
    await expect(db.query(`insert into public.building_units(tenant_id, building_id, unit_no, owner_customer_id) values ('${T}','${B}','9','${foreign}')`)).rejects.toThrow();
  });

  it("toplu tahakkuk: yetki içeride; toplam / daire kümesi / tekrar / başka bina doğrulanır", async () => {
    const shares = [{ unit_id: U1, amount: 333.33 }, { unit_id: U2u, amount: 333.33 }, { unit_id: U3, amount: 333.34 }];
    await as(U, T, "expenses:view");
    expect((await batch(B, "aidat", "2026-10-01", 1000, shares)).outcome).toBe("forbidden");
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('test.tenant','',false)`);
    expect((await batch(B, "aidat", "2026-10-01", 1000, shares)).outcome).toBe("unauthorized");
    await as(U, T, ALL_RENT);
    expect((await batch(B, "aidat", "2026-10-01", 999, shares)).outcome).toBe("sum_mismatch");
    expect((await batch(B, "aidat", "2026-10-15", 1000, shares)).outcome).toBe("invalid_input"); // ayın 1'i değil
    expect((await batch(B, "aidat", "2026-10-01", 1000, [...shares.slice(0, 2), { unit_id: U2u, amount: 333.34 }])).outcome).toBe("invalid_shares"); // tekrar
    expect((await batch(B, "aidat", "2026-10-01", 1000, [...shares.slice(0, 2), { unit_id: OTHER_B_UNIT, amount: 333.34 }])).outcome).toBe("invalid_shares"); // başka bina dairesi
    expect((await batch(B, "aidat", "2026-10-01", 1000, [{ unit_id: U1, amount: 1000.005 }])).outcome).toBe("invalid_shares"); // 3 ondalık
    const ok = await batch(B, "aidat", "2026-10-01", 1000, shares);
    expect(ok).toMatchObject({ outcome: "created", charge_count: 3 });
    BATCH = ok.batch_id as string;
    expect((await batch(B, "aidat", "2026-10-01", 1000, shares)).outcome).toBe("duplicate_period");
    // gider paylaştırma aynı dönemde serbest
    expect((await batch(B, "expense_share", "2026-10-01", 600, [{ unit_id: U1, amount: 300 }, { unit_id: U3, amount: 300 }], "equal", "Asansör bakımı")).outcome).toBe("created");
    const rows = await q(`select unit_id, amount::float8 as amount, payer_role, payer_customer_id from public.building_charges where batch_id = $1 order by amount, unit_id`, [BATCH]);
    expect(rows).toHaveLength(3);
    const byUnit = Object.fromEntries(rows.map((r) => [r.unit_id as string, r]));
    expect(byUnit[U1]).toMatchObject({ payer_role: "owner", payer_customer_id: OWNER }); // ödeyen kopyalanır
    expect(byUnit[U2u]).toMatchObject({ payer_role: "tenant", payer_customer_id: RENTER });
    C1 = (await q(`select id from public.building_charges where batch_id = $1 and unit_id = $2`, [BATCH, U1]))[0]!.id as string;
    C2 = (await q(`select id from public.building_charges where batch_id = $1 and unit_id = $2`, [BATCH, U2u]))[0]!.id as string;
    C3 = (await q(`select id from public.building_charges where batch_id = $1 and unit_id = $2`, [BATCH, U3]))[0]!.id as string;
  });

  it("başka ofisin binasına tahakkuk yazılamaz", async () => {
    await as(U2, T2, ALL_RENT);
    expect((await batch(B, "aidat", "2026-11-01", 100, [{ unit_id: U1, amount: 100 }])).outcome).toBe("not_found");
  });

  it("tahsilat: yetki içeride; kısmi -> kısmi, kalan -> ödendi; makbuz kira ile ortak sayaçtan sıralı; fazla ödeme reddedilir", async () => {
    await as(U, T, "expenses:view");
    expect((await pay(C1, 10)).outcome).toBe("forbidden");
    await as(U, T, ALL_RENT);
    // kira tahsilatı makbuz 1'i alır; bina tahsilatı sayacı paylaşır -> 2
    expect((await rpc(`public.record_rent_payment($1::uuid, 500::numeric, '2026-10-06'::date, 'cash', null)`, [RC])).receipt_no).toBe(1);
    const a = await pay(C1, 100, "2026-10-06", "bank_transfer");
    expect(a).toMatchObject({ outcome: "recorded", receipt_no: 2, charge_status: "partial", paid_amount: 100 });
    expect((await pay(C1, 300)).outcome).toBe("overpayment"); // kalan 233.33
    const b = await pay(C1, 233.33);
    expect(b).toMatchObject({ outcome: "recorded", receipt_no: 3, charge_status: "paid" });
    expect((await pay(C1, 1)).outcome).toBe("already_paid");
    expect((await pay(C2, 0)).outcome).toBe("invalid_input");
    expect((await pay(C2, 10, "2999-01-01")).outcome).toBe("invalid_input");
    expect((await pay(C2, 10, "2026-10-06", "owner_offset")).outcome).toBe("invalid_input"); // mahsup yalnız özel RPC ile
    expect((await charge(C1)).status).toBe("paid");
    expect((await rpc(`public.record_building_payment($1::uuid, 10::numeric, '2026-10-06'::date, 'cash', null)`, [RC])).outcome).toBe("not_found"); // kira tahakkuku bina RPC'sinde yok
  });

  it("yönetim ücreti: yüzde anlık kopyalanır (%10); sabit ücret tahakkuk başına bir kez ve tutarı aşmaz", async () => {
    await as(U, T, ALL_RENT);
    const fees = await q(`select amount::float8 as amount, management_fee::float8 as fee from public.building_payments where charge_id = $1 order by created_at`, [C1]);
    expect(fees).toEqual([{ amount: 100, fee: 10 }, { amount: 233.33, fee: 23.33 }]);
    await db.exec(`reset role; update public.buildings set fee_type='fixed', fee_value=150 where id='${B}'`);
    await as(U, T, ALL_RENT);
    expect((await pay(C3, 100)).management_fee).toBe(100); // tutarı aşmaz
    expect((await pay(C3, 200)).management_fee).toBe(50); // kalan sabit ücret
    expect((await pay(C3, 33.34)).management_fee).toBe(0);
    expect((await charge(C3)).status).toBe("paid");
    await db.exec(`reset role; update public.buildings set managed_by_office=false where id='${B2}'`);
  });

  it("iptal: neden zorunlu, yetki delete, durum ve ücret yeniden türetilir, çift iptal reddedilir", async () => {
    await as(U, T, ALL_RENT);
    const first = (await q(`select id from public.building_payments where charge_id = $1 and amount = 100`, [C1]))[0]!.id as string;
    await as(U, T, "expenses:view expenses:edit");
    expect((await rpc(`public.void_building_payment($1::uuid, 'yanlis giris')`, [first])).outcome).toBe("forbidden");
    await as(U, T, ALL_RENT);
    expect((await rpc(`public.void_building_payment($1::uuid, 'x')`, [first])).outcome).toBe("invalid_input");
    expect(await rpc(`public.void_building_payment($1::uuid, 'yanlis giris')`, [first])).toMatchObject({ outcome: "voided", charge_status: "partial", paid_amount: 233.33 });
    expect((await rpc(`public.void_building_payment($1::uuid, 'yanlis giris')`, [first])).outcome).toBe("already_voided");
    const actions = (await q(`select action from public.audit_logs where action like 'building_%'`)).map((a) => a.action as string);
    expect(actions).toEqual(expect.arrayContaining(["building_batch.create", "building_payment.record", "building_payment.void"]));
    // iptal edilen tahsilat kalan borcu yeniden açar: yeniden tahsil edilebilir
    expect(await pay(C1, 100)).toMatchObject({ outcome: "recorded", charge_status: "paid" });
  });

  it("mahsup: malik borcu kira hakedişinden düşülür; yetki, ödeyen, yönetim sözleşmesi kontrolleri; iptal bağlantıyı kaldırır", async () => {
    await db.exec(`reset role`);
    // yeni dönem tahakkuku: U1 (bağlı kira var, malik öder), U2u (kiracı öder), U3 (kira yok)
    await as(U, T, ALL_RENT);
    const nb = await batch(B, "aidat", "2026-11-01", 900, [{ unit_id: U1, amount: 300 }, { unit_id: U2u, amount: 300 }, { unit_id: U3, amount: 300 }], "equal", "Kasım aidatı");
    expect(nb.outcome).toBe("created");
    const cid = async (unit: string) => (await q(`select id from public.building_charges where batch_id = $1 and unit_id = $2`, [nb.batch_id, unit]))[0]!.id as string;
    const [m1, m2, m3] = [await cid(U1), await cid(U2u), await cid(U3)];
    const off = (c: string, amount: number) => rpc(`public.offset_building_charge_to_owner($1::uuid, $2::numeric)`, [c, amount]);

    await as(U, T, ALL); // rentals:edit yok
    expect((await off(m1, 100)).outcome).toBe("forbidden");
    await as(U, T, ALL_RENT);
    expect((await off(m1, 100)).outcome).toBe("not_managed"); // yönetim sözleşmesi yok
    await db.exec(`reset role; insert into public.rental_management_agreements(tenant_id, rental_id, fee_type, fee_value) values ('${T}','${R}','percent',8)`);
    await as(U, T, ALL_RENT);
    expect((await off(m2, 100)).outcome).toBe("payer_not_owner");
    expect((await off(m3, 100)).outcome).toBe("not_managed"); // bağlı kira yok
    expect((await off(m1, 400)).outcome).toBe("overpayment");
    const ok = await off(m1, 120);
    expect(ok).toMatchObject({ outcome: "recorded", charge_status: "partial", paid_amount: 120 });
    const link = (await q(`select kind, ref_id, amount::float8 as amount, rental_id from public.owner_charge_links where kind = 'unit_charge'`))[0]!;
    expect(link).toMatchObject({ kind: "unit_charge", ref_id: ok.payment_id, amount: 120, rental_id: R });
    const p = (await q(`select method, management_fee::float8 as fee from public.building_payments where id = $1`, [ok.payment_id]))[0]!;
    expect(p).toMatchObject({ method: "owner_offset" });

    // mahsup bağlantısı elle silinemez (yalnız tahsilat iptaliyle kalkar)
    await db.exec(`delete from public.owner_charge_links where kind = 'unit_charge'`);
    expect((await q(`select count(*)::int as n from public.owner_charge_links where kind = 'unit_charge'`))[0]!.n).toBe(1);

    // iptal: rentals:edit yoksa mahsup tahsilatı iptal edilemez
    await as(U, T, ALL);
    expect((await rpc(`public.void_building_payment($1::uuid, 'mahsup yanlis')`, [ok.payment_id])).outcome).toBe("forbidden");
    await as(U, T, ALL_RENT);
    expect((await rpc(`public.void_building_payment($1::uuid, 'mahsup yanlis')`, [ok.payment_id])).outcome).toBe("voided");
    expect((await q(`select count(*)::int as n from public.owner_charge_links where kind = 'unit_charge'`))[0]!.n).toBe(0);
    expect((await charge(m1)).status).toBe("pending");
  });

  it("tahakkuk iptali: tahsilat varken reddedilir; tahsilat iptalinden sonra iptal edilir, satırlar kapanır", async () => {
    await as(U, T, ALL_RENT);
    expect((await rpc(`public.void_building_batch($1::uuid, 'yanlis donem')`, [BATCH])).outcome).toBe("has_payments");
    const ex = await batch(B2, "expense_share", "2026-10-01", 50, [{ unit_id: OTHER_B_UNIT, amount: 50 }], "equal", "Bahçe");
    expect(ex.outcome).toBe("created");
    await as(U, T, "expenses:view expenses:edit");
    expect((await rpc(`public.void_building_batch($1::uuid, 'yanlis gider')`, [ex.batch_id])).outcome).toBe("forbidden");
    await as(U, T, ALL_RENT);
    expect((await rpc(`public.void_building_batch($1::uuid, 'x')`, [ex.batch_id])).outcome).toBe("invalid_input");
    expect((await rpc(`public.void_building_batch($1::uuid, 'yanlis gider')`, [ex.batch_id])).outcome).toBe("voided");
    expect((await rpc(`public.void_building_batch($1::uuid, 'yanlis gider')`, [ex.batch_id])).outcome).toBe("already_voided");
    const cid = (await q(`select id from public.building_charges where batch_id = $1`, [ex.batch_id]))[0]!.id as string;
    expect((await pay(cid, 10)).outcome).toBe("not_found"); // iptal edilen tahakkuka tahsilat yazılamaz
    // iptal edilen dönem aidatı yeniden açılabilir
    const re = await batch(B2, "aidat", "2026-10-01", 80, [{ unit_id: OTHER_B_UNIT, amount: 80 }], "equal", "Ekim aidatı");
    expect(re.outcome).toBe("created");
    expect((await rpc(`public.void_building_batch($1::uuid, 'tekrar')`, [re.batch_id])).outcome).toBe("voided");
    expect((await batch(B2, "aidat", "2026-10-01", 80, [{ unit_id: OTHER_B_UNIT, amount: 80 }])).outcome).toBe("created");
  });

  it("KPI: bu ay tahakkuk / tahsil / ücret / geciken / toplam borç kendi ofisine aittir", async () => {
    await as(U, T, ALL_RENT);
    const k = (await q(`select * from public.building_dues_kpi('2026-10-01'::date)`))[0] as Record<string, unknown>;
    expect(Number(k.charged_month)).toBe(1600 + 80); // Ekim aidatı 1000 + Asansör 600 + (B2'de açık kalan 80)
    expect(Number(k.collected_month)).toBeGreaterThan(0);
    expect(Number(k.fee_month)).toBeGreaterThan(0);
    expect(Number(k.outstanding_total)).toBeGreaterThan(0);
    expect(Number(k.overdue_total)).toBeLessThanOrEqual(Number(k.outstanding_total));
    await as(U2, T2, ALL_RENT);
    const other = (await q(`select * from public.building_dues_kpi('2026-10-01'::date)`))[0] as Record<string, unknown>;
    expect([Number(other.charged_month), Number(other.collected_month), Number(other.outstanding_total)]).toEqual([0, 0, 0]);
  });

  it("RLS: başka ofis göremez; expenses:view olmayan göremez; istemci doğrudan tahakkuk/tahsilat yazamaz", async () => {
    await as(U2, T2, ALL_RENT);
    for (const t of ["buildings", "building_units", "building_charge_batches", "building_charges", "building_payments"]) {
      expect((await q(`select count(*)::int as n from public.${t}`))[0]!.n, t).toBe(0);
    }
    await as(U, T, "rentals:view rentals:edit");
    expect((await q(`select count(*)::int as n from public.building_charges`))[0]!.n).toBe(0);
    await as(U, T, ALL_RENT);
    expect((await q(`select count(*)::int as n from public.building_charges`))[0]!.n).toBeGreaterThan(0);
    await expect(db.query(`insert into public.building_charges(tenant_id, batch_id, building_id, unit_id, amount, due_date, payer_role) values ('${T}','${BATCH}','${B}','${U1}',1,'2026-10-05','owner')`)).rejects.toThrow();
    await expect(db.query(`insert into public.building_payments(tenant_id, charge_id, unit_id, building_id, amount, paid_on, method, receipt_no) values ('${T}','${C2}','${U2u}','${B}',1,'2026-10-01','cash',999)`)).rejects.toThrow();
    await expect(db.query(`insert into public.building_charge_batches(tenant_id, building_id, kind, period, title, total_amount, distribution, due_date) values ('${T}','${B}','aidat','2027-01-01','x',1,'equal','2027-01-05')`)).rejects.toThrow();
    // başka ofisin binasını güncelleme sessizce 0 satır
    await as(U2, T2, ALL_RENT);
    await db.exec(`update public.buildings set name = 'ele gecirildi' where id = '${B}'`);
    await db.exec(`reset role`);
    expect((await q(`select name from public.buildings where id = $1`, [B]))[0]!.name).toBe("Güneş Apt.");
  });

  it("tutar / ücret kısıtları: yüzde 0-100, ayın 1'i dışı dönem, negatif tutar reddedilir", async () => {
    await db.exec(`reset role`);
    await expect(db.query(`update public.buildings set fee_type='percent', fee_value=101 where id='${B}'`)).rejects.toThrow();
    await expect(db.query(`update public.buildings set fee_type='fixed', fee_value=null where id='${B}'`)).rejects.toThrow();
    await expect(db.query(`insert into public.building_charge_batches(tenant_id, building_id, kind, period, title, total_amount, distribution, due_date) values ('${T}','${B}','aidat','2027-01-02','x',1,'equal','2027-01-05')`)).rejects.toThrow();
    await expect(db.query(`insert into public.building_charge_batches(tenant_id, building_id, kind, period, title, total_amount, distribution, due_date) values ('${T}','${B}','aidat','2027-01-01','x',-1,'equal','2027-01-05')`)).rejects.toThrow();
  });

  it("rollback: fonksiyonlar ve tablolar düşer, bağlantı CHECK'i eski haline döner", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261008001700_building_management.rollback.sql"));
    expect((await q(`select to_regclass('public.building_charges') as t`))[0]!.t).toBeNull();
    expect((await q(`select to_regprocedure('public.record_building_payment(uuid,numeric,date,text,text)') as f`))[0]!.f).toBeNull();
    await expect(db.query(`insert into public.owner_charge_links(tenant_id, rental_id, kind, ref_id, amount, entry_date, label) values ('${T}','${R}','unit_charge',gen_random_uuid(),1,'2026-10-01','x')`)).rejects.toThrow();
    // M1 tabloları sağlam kalır
    expect((await q(`select count(*)::int as n from public.rent_payments`))[0]!.n).toBeGreaterThan(0);
  });
});
