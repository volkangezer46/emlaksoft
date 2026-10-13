import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013004500 platform_member_search — e-postayla bulma, LIKE jokerinin kaçışı,
 * telefonda yalnız rakam eşleşmesi, giriş/2FA/şube süzgeçleri, sayfalama + toplam, yalnız service_role ve geri alma.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const B1 = "33333333-3333-4333-8333-333333333333";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
grant usage on schema auth, public to authenticated, anon, service_role;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create table auth.users(id uuid primary key, email text, last_sign_in_at timestamptz);
create table public.tenants(id uuid primary key, name text);
create table public.branches(id uuid primary key, tenant_id uuid, name text);
create table public.profiles(id uuid primary key, tenant_id uuid, branch_id uuid, full_name text, phone text, role text,
  is_active boolean not null default true, two_factor_sms boolean not null default false, created_at timestamptz not null default now());
insert into public.tenants values ('${T1}', 'Kadıköy Emlak'), ('${T2}', 'Bodrum Emlak');
insert into public.branches values ('${B1}', '${T1}', 'Moda');
insert into public.profiles(id, tenant_id, branch_id, full_name, phone, role, is_active, two_factor_sms, created_at) values
  ('${U(1)}', '${T1}', '${B1}', 'Ayşe Danışman', '05321234567', 'advisor', true, true, now() - interval '1 day'),
  ('${U(2)}', '${T1}', null, 'Mehmet Sahip', '05559876543', 'owner', true, false, now() - interval '2 day'),
  ('${U(3)}', '${T2}', null, 'Zeynep Yeni', null, 'advisor', true, false, now() - interval '3 day'),
  ('${U(4)}', '${T2}', null, 'Ali Eski', '02161112233', 'call_center', false, false, now() - interval '4 day');
insert into auth.users values
  ('${U(1)}', 'ayse@kadikoy.test', now() - interval '1 hour'),
  ('${U(2)}', 'mehmet_x@kadikoy.test', now() - interval '45 day'),
  ('${U(3)}', 'zeynep@bodrum.test', null),
  ('${U(4)}', 'ali%eski@bodrum.test', now() - interval '3 day');
`;

describe.skipIf(!mod)("platform_member_search (pglite)", () => {
  let db: Db;
  const q = async (sql: string) => (await db.query(sql)).rows;
  const search = async (args: string) => q(`select id, email, tenant_name, branch_name, total_count from public.platform_member_search(${args})`);
  const asService = () => db.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false)`);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261013004500_platform_member_search.sql"));
    await asService();
  });

  it("destek e-postayla üyeyi bulur; ofis/şube adı ve toplam aynı turda döner", async () => {
    const rows = await search(`p_q => 'ayse@kadikoy'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: U(1), email: "ayse@kadikoy.test", tenant_name: "Kadıköy Emlak", branch_name: "Moda" });
    expect(Number(rows[0].total_count)).toBe(1);
  });

  it("LIKE jokerleri kaçışlanır: '%' ve '_' tüm listeyi döndürmez", async () => {
    expect((await search(`p_q => '%'`)).map((r) => r.id)).toEqual([U(4)]);
    expect((await search(`p_q => '_x@'`)).map((r) => r.id)).toEqual([U(2)]);
  });

  it("telefon: biçimli yazım rakamlarla eşleşir", async () => {
    expect((await search(`p_q => '0532 123 45'`)).map((r) => r.id)).toEqual([U(1)]);
  });

  it("giriş, 2FA, şube, ofis ve durum süzgeçleri", async () => {
    expect((await search(`p_login => 'never'`)).map((r) => r.id)).toEqual([U(3)]);
    expect((await search(`p_login => 'stale'`)).map((r) => r.id)).toEqual([U(2)]);
    expect((await search(`p_login => 'recent'`)).map((r) => r.id)).toEqual([U(1), U(4)]);
    expect((await search(`p_two_factor => true`)).map((r) => r.id)).toEqual([U(1)]);
    expect((await search(`p_branch => '${B1}'`)).map((r) => r.id)).toEqual([U(1)]);
    expect((await search(`p_tenant => '${T2}', p_active => false`)).map((r) => r.id)).toEqual([U(4)]);
    expect((await search(`p_ids => array['${U(3)}','${U(2)}']::uuid[]`)).map((r) => r.id)).toEqual([U(2), U(3)]);
  });

  it("sayfalama: limit/offset + toplam sayı", async () => {
    const page = await search(`p_limit => 2, p_offset => 2`);
    expect(page.map((r) => r.id)).toEqual([U(3), U(4)]);
    expect(Number(page[0].total_count)).toBe(4);
  });

  it("geçersiz giriş süzgeci reddedilir", async () => {
    await expect(search(`p_login => 'bogus'`)).rejects.toThrow(/invalid_login_filter/);
  });

  it("yalnız service_role: authenticated çağrısı reddedilir", async () => {
    await db.exec(`select set_config('request.jwt.claim.role','authenticated',false); set role authenticated`);
    await expect(search(`p_q => 'a'`)).rejects.toThrow();
    await asService();
  });

  it("geri alma dosyası fonksiyonu düşürür", async () => {
    await db.exec(read("supabase/rollbacks/20261013004500_platform_member_search.rollback.sql"));
    const rows = await q(`select count(*)::int as n from pg_proc where proname = 'platform_member_search'`);
    expect(rows[0].n).toBe(0);
  });
});
