import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261014007000 — ofis oturum RPC'leri yalnız service_role; liste ve kapatma ofis
 * sınırının (profiles.tenant_id) dışına çıkmaz; pasif kullanıcı listelenmez; 2FA oturum kanıtı da silinir.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('t.role', true), ''), 'authenticated') $$;
create table auth.users(id uuid primary key);
create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now(),
  updated_at timestamptz default now(), refreshed_at timestamp, user_agent text, ip inet, aal text, not_after timestamptz);
create table public.profiles(id uuid primary key references auth.users(id), tenant_id uuid, role text, is_active boolean default true);
create table public.two_factor_verified_sessions(session_id uuid primary key, user_id uuid not null);
`;

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const U1 = "aaaaaaaa-0000-4000-8000-000000000001";
const U2 = "aaaaaaaa-0000-4000-8000-000000000002";
const U3 = "aaaaaaaa-0000-4000-8000-000000000003";
const S1 = "bbbbbbbb-0000-4000-8000-000000000001";
const S2 = "bbbbbbbb-0000-4000-8000-000000000002";
const S3 = "bbbbbbbb-0000-4000-8000-000000000003";
const S4 = "bbbbbbbb-0000-4000-8000-000000000004";

describe.skipIf(!mod)("DG7 ofis oturum RPC'leri (pglite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261014007000_office_security_sessions.sql"));
    await db.exec(`insert into auth.users values ('${U1}'), ('${U2}'), ('${U3}');
      insert into public.profiles(id, tenant_id, role, is_active) values
        ('${U1}', '${T1}', 'owner', true), ('${U2}', '${T2}', 'owner', true), ('${U3}', '${T1}', 'advisor', false);
      insert into auth.sessions(id, user_id, ip, user_agent) values
        ('${S1}', '${U1}', '198.51.100.1', 'tarayıcı'), ('${S2}', '${U2}', null, null), ('${S3}', '${U3}', null, null);
      insert into auth.sessions(id, user_id, not_after) values ('${S4}', '${U1}', now() - interval '1 hour');
      insert into public.two_factor_verified_sessions values ('${S1}', '${U1}');`);
  });

  it("service_role dışı çağrı reddedilir", async () => {
    await expect(db.query(`select * from public.office_list_sessions('${T1}')`)).rejects.toThrow(/Service role/);
    await expect(db.query(`select public.office_revoke_session('${T1}', '${S1}')`)).rejects.toThrow(/Service role/);
  });

  it("liste yalnız ofisin aktif kullanıcılarının süresi dolmamış oturumları", async () => {
    await db.exec(`set t.role = 'service_role'`);
    const { rows } = await db.query(`select session_id, user_id, ip from public.office_list_sessions('${T1}')`);
    expect(rows).toEqual([{ session_id: S1, user_id: U1, ip: "198.51.100.1" }]);
    expect((await db.query(`select * from public.office_list_sessions(null)`)).rows).toEqual([]);
    await db.exec(`reset t.role`);
  });

  it("başka ofisin oturumu kapatılamaz; kendi ofisinde kapatılır ve 2FA kanıtı silinir", async () => {
    await db.exec(`set t.role = 'service_role'`);
    expect((await db.query(`select public.office_revoke_session('${T1}', '${S2}') as ok`)).rows[0].ok).toBe(false);
    expect((await db.query(`select count(*)::int as n from auth.sessions where id = '${S2}'`)).rows[0].n).toBe(1);
    expect((await db.query(`select public.office_revoke_session('${T1}', '${S1}') as ok`)).rows[0].ok).toBe(true);
    expect((await db.query(`select count(*)::int as n from auth.sessions where id = '${S1}'`)).rows[0].n).toBe(0);
    expect((await db.query(`select count(*)::int as n from public.two_factor_verified_sessions`)).rows[0].n).toBe(0);
    expect((await db.query(`select public.office_revoke_session('${T1}', '${S1}') as ok`)).rows[0].ok).toBe(false);
    await db.exec(`reset t.role`);
  });

  it("rollback iki fonksiyonu kaldırır", async () => {
    await db.exec(read("supabase/rollbacks/20261014007000_office_security_sessions.rollback.sql"));
    const { rows } = await db.query(`select count(*)::int as n from pg_proc where proname in ('office_list_sessions', 'office_revoke_session')`);
    expect(rows[0].n).toBe(0);
  });
});
