import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261010000600_finance_accounts_cash_entries — hesap aç/arşivle, hareket yaz, bakiye türetme,
 * transfer iki bacak, kaynak bağı benzersizliği (çift sayım yok), gider kaydı üretimi/iptali, kişisel hesap gizliliği
 * (ofis sahibi dahil kimse göremez), maaş kategorisi yalnız owner/gm, ofis izolasyonu, doğrudan yazma yok, rollback.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

describe.skipIf(!mod)("finance_accounts + cash_entries (pglite)", () => {
  let db: Db;
  let T: string, T2: string, OWNER: string, ADV: string, ADV2: string, ACC: string, OTHER: string;
  let OFFICE: string, BANK: string, PERSONAL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const FULL = "expenses:view expenses:create expenses:edit expenses:delete commissions:edit rentals:edit rentals:delete";
  const VIEW = "expenses:view";
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const create = (scope: string, kind: string, name: string, opening = 0, date = "2026-10-01") =>
    rpc(`public.finance_account_create($1, $2, $3, null, 'TRY', $4::numeric, $5::date)`, [scope, kind, name, opening, date]);
  const record = (acc: string, dir: string, amount: number, cat: string, title: string, opts: { date?: string; src?: string; srcId?: string | null; expense?: boolean } = {}) =>
    rpc(`public.finance_record_entry($1::uuid, $2, $3::numeric, $4::date, $5, $6, null, null, null, $7, $8::uuid, $9::boolean, 'ofis')`,
      [acc, dir, amount, opts.date ?? "2026-10-05", cat, title, opts.src ?? "manual", opts.srcId ?? null, opts.expense ?? false]);
  const balance = async (acc: string) =>
    Number((await q(`select balance::float8 as b from public.finance_account_balances() where account_id = $1`, [acc]))[0]?.b);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ADV2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ACC = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    OTHER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
  });

  it("ofis hesabı yetkiye bağlı açılır; danışman ofis hesabı açamaz, kişisel hesap açabilir", async () => {
    await as(ADV, T, "", "advisor");
    expect((await create("office", "cash", "Ofis kasası")).outcome).toBe("forbidden");
    PERSONAL = (await create("user", "cash", "Benim kasam", 1000, "2026-10-01")).account_id as string;
    expect(PERSONAL).toBeTruthy();
    await as(OWNER, T, FULL, "owner");
    const cash = await create("office", "cash", "Ofis Kasasi", 5000);
    OFFICE = cash.account_id as string;
    expect(cash.outcome).toBe("created");
    BANK = (await create("office", "bank", "İş Bankası Kadıköy", 20000)).account_id as string;
    expect((await create("office", "bank", "ofis kasasi")).outcome).toBe("duplicate_name");
    expect((await create("office", "bank", "x", 0, "2090-01-01")).outcome).toBe("invalid_input");
  });

  it("kişisel hesap ofis sahibi dahil kimseye görünmez", async () => {
    await as(OWNER, T, FULL, "owner");
    const rows = await q(`select id from public.finance_accounts`);
    expect(rows.map((r) => r.id)).not.toContain(PERSONAL);
    expect((await q(`select account_id from public.finance_account_balances()`)).map((r) => r.account_id)).not.toContain(PERSONAL);
    expect((await rpc(`public.finance_record_entry($1::uuid,'in',10,'2026-10-05'::date,'x','Deneme',null,null,null,'manual',null,false,null)`, [PERSONAL])).outcome).toBe("forbidden");
    await as(ADV2, T, VIEW, "advisor");
    expect((await q(`select id from public.finance_accounts where id = $1`, [PERSONAL]))).toHaveLength(0);
    await as(ADV, T, "", "advisor");
    expect((await q(`select id from public.finance_accounts`)).map((r) => r.id)).toEqual([PERSONAL]);
  });

  it("bakiye = açılış + girişler - çıkışlar; açılıştan önceki tarih reddedilir; iptal bakiyeyi geri alır", async () => {
    await as(OWNER, T, FULL, "owner");
    expect(await balance(OFFICE)).toBe(5000);
    const inc = await record(OFFICE, "in", 1500.5, "hizmet_bedeli", "Danışmanlık bedeli");
    expect(inc.outcome).toBe("recorded");
    await record(OFFICE, "out", 300.25, "ulasim", "Yakıt");
    expect(await balance(OFFICE)).toBeCloseTo(5000 + 1500.5 - 300.25, 2);
    expect((await record(OFFICE, "out", 5, "diger", "Eski", { date: "2026-09-01" })).outcome).toBe("before_opening");
    expect((await record(OFFICE, "out", 0, "diger", "Sıfır")).outcome).toBe("invalid_input");
    expect((await record(OFFICE, "out", 1.234, "diger", "Kuruş")).outcome).toBe("invalid_input");
    const v = await rpc(`public.finance_void_entry($1::uuid, 'Yanlış girildi')`, [inc.entry_id]);
    expect(v.outcome).toBe("voided");
    expect(await balance(OFFICE)).toBeCloseTo(5000 - 300.25, 2);
    expect((await rpc(`public.finance_void_entry($1::uuid, 'Yanlış girildi')`, [inc.entry_id])).outcome).toBe("already_voided");
  });

  it("gider ekleme expenses kaydı üretir; iptal ve düzenleme ikisini birlikte yürütür", async () => {
    await as(OWNER, T, FULL, "owner");
    const r = await record(OFFICE, "out", 750, "reklam", "Instagram reklamı", { expense: true });
    expect(r.expense_id).toBeTruthy();
    expect((await q(`select amount::float8 as a, category from public.expenses where id = $1`, [r.expense_id]))[0]).toMatchObject({ a: 750, category: "ofis" });
    const u = await rpc(`public.finance_update_entry($1::uuid, 800::numeric, '2026-10-06'::date, 'reklam', 'Instagram reklamı', null, null, null, 'reklam')`, [r.entry_id]);
    expect(u.outcome).toBe("updated");
    expect((await q(`select amount::float8 as a, category from public.expenses where id = $1`, [r.expense_id]))[0]).toMatchObject({ a: 800, category: "reklam" });
    await rpc(`public.finance_void_entry($1::uuid, 'Tekrar girildi')`, [r.entry_id]);
    expect(await q(`select 1 from public.expenses where id = $1`, [r.expense_id])).toHaveLength(0);
  });

  it("var olan gider kaydına bağlanır; aynı gider ikinci kez bağlanamaz; hareket iptali o gideri SİLMEZ", async () => {
    await db.exec(`reset role`);
    const exp = (await q(`insert into public.expenses(tenant_id, title, amount, expense_date) values ($1, 'Kırtasiye', 120, '2026-10-04') returning id`, [T]))[0]!.id as string;
    await as(OWNER, T, FULL, "owner");
    const link = (e: string) =>
      rpc(`public.finance_record_entry($1::uuid,'out',120::numeric,'2026-10-04'::date,'ofis','Kırtasiye',null,null,null,'manual',null,false,null,$2::uuid)`, [OFFICE, e]);
    const first = await link(exp);
    expect(first.outcome).toBe("recorded");
    expect((await link(exp)).outcome).toBe("duplicate");
    expect((await link(T)).outcome).toBe("invalid_input");
    await rpc(`public.finance_void_entry($1::uuid, 'Bağ kaldırıldı')`, [first.entry_id]);
    expect(await q(`select 1 from public.expenses where id = $1`, [exp])).toHaveLength(1);
  });

  it("transfer iki bacağı tek seferde yazar; bakiyeler kayar; iptal ikisini birlikte alır; aynı hesaba/farklı para birimine reddedilir", async () => {
    await as(OWNER, T, FULL, "owner");
    const before = [await balance(OFFICE), await balance(BANK)];
    const t = await rpc(`public.finance_transfer($1::uuid, $2::uuid, 1000::numeric, '2026-10-06'::date, 'Para yatırma')`, [OFFICE, BANK]);
    expect(t.outcome).toBe("transferred");
    expect(await balance(OFFICE)).toBeCloseTo(before[0]! - 1000, 2);
    expect(await balance(BANK)).toBeCloseTo(before[1]! + 1000, 2);
    const legs = await q(`select id from public.cash_entries where transfer_group_id = $1 and voided_at is null`, [t.transfer_group_id]);
    expect(legs).toHaveLength(2);
    expect((await rpc(`public.finance_transfer($1::uuid, $1::uuid, 5::numeric, '2026-10-06'::date, null)`, [OFFICE])).outcome).toBe("invalid_input");
    const v = await rpc(`public.finance_void_entry($1::uuid, 'Yanlış hesap')`, [legs[0]!.id]);
    expect(v).toMatchObject({ outcome: "voided", count: 2 });
    expect(await balance(OFFICE)).toBeCloseTo(before[0]!, 2);
    expect(await balance(BANK)).toBeCloseTo(before[1]!, 2);
  });

  it("aynı komisyon tahsilatı aynı hesaba iki kez hareket üretmez; geri alınca iptal edilir ve yeniden yazılabilir", async () => {
    await as(OWNER, T, FULL, "owner");
    await db.exec(`reset role`);
    const com = (await q(`insert into public.commissions(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await as(OWNER, T, FULL, "owner");
    const first = await record(BANK, "in", 42000, "komisyon", "Komisyon tahsilatı", { src: "commission", srcId: com });
    expect(first.outcome).toBe("recorded");
    const second = await record(BANK, "in", 42000, "komisyon", "Komisyon tahsilatı", { src: "commission", srcId: com });
    expect(second).toMatchObject({ outcome: "duplicate", entry_id: first.entry_id });
    expect((await q(`select 1 from public.cash_entries where source_id = $1 and voided_at is null`, [com]))).toHaveLength(1);
    expect((await record(BANK, "in", 1, "komisyon", "Olmayan kaynak", { src: "commission", srcId: T })).outcome).toBe("source_not_found");
    expect((await record(BANK, "out", 1, "komisyon", "Çıkış olamaz", { src: "commission", srcId: com })).outcome).toBe("invalid_input");
    // düzenleme/elle iptal dışında: kaynak bağlı hareketin tutarı kilitli
    expect((await rpc(`public.finance_update_entry($1::uuid, 1::numeric, '2026-10-05'::date, 'komisyon', 'x', null, null, null, null)`, [first.entry_id])).outcome).toBe("locked");
    expect((await rpc(`public.finance_void_source_entries('commission', $1::uuid, 'Tahsilat geri alındı')`, [com])).count).toBe(1);
    expect((await record(BANK, "in", 42000, "komisyon", "Komisyon tahsilatı", { src: "commission", srcId: com })).outcome).toBe("recorded");
  });

  it("maaş hareketi ofis hesabında yalnız owner/gm tarafından yazılır ve okunur", async () => {
    await as(OWNER, T, FULL, "owner");
    const sal = await record(OFFICE, "out", 30000, "maas", "Ekim maaşı");
    expect(sal.outcome).toBe("recorded");
    expect((await q(`select 1 from public.expenses where title = 'Ekim maaşı'`))).toHaveLength(0);
    await as(ACC, T, FULL, "accounting");
    expect((await record(OFFICE, "out", 100, "maas", "Maaş denemesi")).outcome).toBe("forbidden");
    expect((await q(`select id from public.cash_entries where id = $1`, [sal.entry_id]))).toHaveLength(0);
    expect((await q(`select id from public.cash_entries where category <> 'maas'`)).length).toBeGreaterThan(0);
    // bakiye yine doğru (maaş çıkışı dahil)
    const accBal = await balance(OFFICE);
    await as(OWNER, T, FULL, "owner");
    expect(await balance(OFFICE)).toBeCloseTo(accBal, 2);
    expect((await rpc(`public.finance_void_entry($1::uuid, 'Deneme iptali')`, [sal.entry_id])).outcome).toBe("voided");
  });

  it("görüntüleme yetkisi yazamaz; ofis sahibinin kişisel hareketi kendi hesabında ve ofis özetinde ayrı kalır", async () => {
    await as(ACC, T, VIEW, "accounting");
    expect((await record(OFFICE, "in", 10, "diger", "İzinsiz")).outcome).toBe("forbidden");
    await as(ADV, T, "", "advisor");
    expect((await record(PERSONAL, "in", 2500, "komisyon", "Payım")).outcome).toBe("recorded");
    expect(await balance(PERSONAL)).toBe(3500);
    const sum = await q(`select sum(total)::float8 as t from public.finance_cash_summary(null, null) where direction = 'in'`);
    expect(Number(sum[0]!.t)).toBe(2500);
    await as(OWNER, T, FULL, "owner");
    const ownerSum = await q(`select distinct account_id from public.finance_cash_summary(null, null)`);
    expect(ownerSum.map((r) => r.account_id)).not.toContain(PERSONAL);
  });

  it("farklı ofis hesabı göremez/yazamaz; tablolara doğrudan yazma yoktur", async () => {
    await as(OTHER, T2, FULL, "owner");
    expect(await q(`select id from public.finance_accounts`)).toHaveLength(0);
    expect(await q(`select id from public.cash_entries`)).toHaveLength(0);
    expect((await record(OFFICE, "in", 10, "diger", "Çapraz ofis")).outcome).toBe("not_found");
    await as(OWNER, T, FULL, "owner");
    await expect(db.exec(`insert into public.cash_entries(tenant_id, account_id, direction, amount, currency, entry_date, kind, title) values ('${T}', '${OFFICE}', 'in', 1, 'TRY', '2026-10-05', 'income', 'x')`)).rejects.toThrow();
    await expect(db.exec(`update public.finance_accounts set name = 'Hack'`)).rejects.toThrow();
  });

  it("arşivlenen hesaba hareket yazılamaz; geri alınınca yazılır", async () => {
    await as(OWNER, T, FULL, "owner");
    expect((await rpc(`public.finance_account_set_archived($1::uuid, true)`, [BANK])).outcome).toBe("archived");
    expect((await record(BANK, "in", 5, "diger", "Arşivde")).outcome).toBe("archived");
    await rpc(`public.finance_account_set_archived($1::uuid, false)`, [BANK]);
    expect((await record(BANK, "in", 5, "diger", "Geri açıldı")).outcome).toBe("recorded");
  });

  it("rollback tabloları ve fonksiyonları düşürür", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261010000600_finance_accounts_cash_entries.rollback.sql"));
    expect((await q(`select to_regclass('public.cash_entries') as t`))[0]!.t).toBeNull();
    expect((await q(`select to_regprocedure('public.finance_transfer(uuid,uuid,numeric,date,text)') as t`))[0]!.t).toBeNull();
  });
});
