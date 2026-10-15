import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { foldTrSql } from "@/lib/pgrst";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016070000 customer_search_fold — üretilmiş search_fold/phone_digits sütunları
 * istemci katlamasıyla (foldTrSql) aynı sonucu verir; 'IŞIK' / 'kemal isik' / 'caglar' aramaları ve 6 telefon biçimi
 * bulur; lookup_customer_by_phone yalnız oturum kiracısında ve customers:view izniyle, yalnız ad + maskeli telefon +
 * danışman adı döndürür; migration iki kez koşulabilir (idempotent); geri alma temizler.
 */
const mod = await loadPglite();
const trgm = await import("@electric-sql/pglite/contrib/pg_trgm").then((m) => m.pg_trgm).catch(() => null);
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.profiles(id uuid primary key, tenant_id uuid, full_name text);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text not null,
  phone text, email text, assigned_to uuid, created_at timestamptz not null default now(), deleted_at timestamptz);
`;

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const ADV = "33333333-3333-4333-8333-333333333333";

describe.skipIf(!mod || !trgm)("customer_search_fold (pglite)", () => {
  let db: Db;
  const as = async (tenant: string, perms: string) => {
    await db.exec(`select set_config('test.tenant', '${tenant}', false), set_config('test.perms', '${perms}', false)`);
  };

  beforeAll(async () => {
    const Ctor = mod!.PGlite as unknown as new (opts: unknown) => Db;
    db = new Ctor({ extensions: { pg_trgm: trgm } });
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260725000056_fold_tr_dotted_i.sql"));
    await db.exec(read("supabase/migrations/20261016070000_customer_search_fold.sql"));
    await db.exec(read("supabase/migrations/20261016070000_customer_search_fold.sql")); // idempotent
    await db.exec(`
      insert into public.profiles values ('${ADV}', '${T1}', 'Danışman Deniz');
      insert into public.customers(tenant_id, full_name, phone, email, assigned_to) values
        ('${T1}', 'Kemal Işık', '05321112233', 'KEMAL@ornek.com', '${ADV}'),
        ('${T1}', 'Çağlar Öztürk', '05559990001', null, null),
        ('${T1}', 'İsmail Şen', '+4915123456789', null, null),
        ('${T2}', 'Başka Ofis', '05559990001', null, null);
    `);
  });

  it("üretilmiş sütunlar istemci katlamasıyla aynı", async () => {
    const { rows } = await db.query(`select full_name, email, search_fold, phone_digits from public.customers where tenant_id = $1 order by full_name`, [T1]);
    for (const r of rows) {
      expect(r.search_fold).toBe(foldTrSql(`${r.full_name} ${r.email ?? ""}`));
    }
    expect(rows.map((r) => r.phone_digits).sort()).toEqual(["05321112233", "05559990001", "4915123456789"]);
  });

  it("Türkçe aramalar ve telefon biçimleri bulur", async () => {
    const find = async (col: string, needle: string) =>
      (await db.query(`select full_name from public.customers where tenant_id = $1 and ${col} ilike $2`, [T1, `%${needle}%`])).rows.map((r) => r.full_name);
    for (const q of ["IŞIK", "kemal isik", "KEMAL IŞIK", "kemal ışık"]) expect(await find("search_fold", foldTrSql(q)), q).toEqual(["Kemal Işık"]);
    expect(await find("search_fold", foldTrSql("caglar"))).toEqual(["Çağlar Öztürk"]);
    expect(await find("search_fold", foldTrSql("İSMAİL"))).toEqual(["İsmail Şen"]);
    expect(await find("phone_digits", "5321112233")).toEqual(["Kemal Işık"]);
  });

  it("lookup_customer_by_phone: kiracı + izin şartlı, maskeli, 6 biçim", async () => {
    await as(T1, "customers:view");
    for (const p of ["05559990001", "0555 999 00 01", "+90 555 999 00 01", "905559990001", "5559990001", "00905559990001"]) {
      const { rows } = await db.query(`select * from public.lookup_customer_by_phone($1)`, [p]);
      expect(rows, p).toEqual([{ full_name: "Çağlar Öztürk", phone_masked: "0555 *** ** 01", advisor_name: null }]);
    }
    const adv = await db.query(`select * from public.lookup_customer_by_phone('0532 111 22 33')`);
    expect(adv.rows[0]).toMatchObject({ full_name: "Kemal Işık", advisor_name: "Danışman Deniz" });
    expect(Object.keys(adv.rows[0]!)).toEqual(["full_name", "phone_masked", "advisor_name"]);
    // Görünen kayıtlar hariç tutulabilir.
    const ids = (await db.query(`select id from public.customers where phone = '05321112233'`)).rows.map((r) => r.id);
    expect((await db.query(`select * from public.lookup_customer_by_phone($1, $2::uuid[])`, ["05321112233", ids])).rows).toEqual([]);
    // İzin yoksa boş; başka kiracıda kendi kaydı.
    await as(T1, "");
    expect((await db.query(`select * from public.lookup_customer_by_phone('05559990001')`)).rows).toEqual([]);
    await as(T2, "customers:view");
    expect((await db.query(`select full_name from public.lookup_customer_by_phone('05559990001')`)).rows).toEqual([{ full_name: "Başka Ofis" }]);
  });

  it("geri alma sütunları, indeksleri ve RPC'yi kaldırır", async () => {
    await db.exec(read("supabase/rollbacks/20261016070000_customer_search_fold.rollback.sql"));
    const cols = await db.query(`select column_name from information_schema.columns where table_name = 'customers' and column_name in ('search_fold', 'phone_digits')`);
    expect(cols.rows).toEqual([]);
    const fn = await db.query(`select 1 from pg_proc where proname = 'lookup_customer_by_phone'`);
    expect(fn.rows).toEqual([]);
  });
});
