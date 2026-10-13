import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013005000 — platform_audit_logs YALNIZ EKLENİR (UPDATE/DELETE/TRUNCATE yasak;
 * personel silinince FK set-null istisnası), destek erişimi geçmişi gerekçe/bilet zorunluluğu, oturum RPC'leri.
 * Bağımlı çekirdek tablolar ilk migration'daki biçimleriyle sadeleştirilmiş kopyadır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('t.role', true), ''), 'authenticated') $$;
create table auth.users(id uuid primary key);
create table auth.sessions(id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz default now(),
  updated_at timestamptz default now(), refreshed_at timestamp, user_agent text, ip inet, aal text, not_after timestamptz);
create table public.tenants(id uuid primary key default gen_random_uuid(), name text);
create table public.platform_staff(id uuid primary key, email text, role text default 'super_admin', is_active boolean default true);
create table public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.platform_staff(id) on delete set null,
  action text not null, entity_type text, entity_id uuid, meta jsonb, created_at timestamptz not null default now());
create table public.platform_impersonation_sessions (staff_id uuid primary key references public.platform_staff(id) on delete cascade,
  auth_session_id text not null, target_tenant_id uuid not null references public.tenants(id) on delete cascade,
  original_app_metadata jsonb not null default '{}', started_at timestamptz not null default now(), expires_at timestamptz not null);
`;

const STAFF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!mod)("AD11 denetim izi append-only (pglite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261013005000_ad11_security_hardening.sql"));
    await db.exec(`insert into auth.users values ('${STAFF}'), ('${OTHER}');
      insert into public.platform_staff(id, email) values ('${STAFF}', 'a@x'), ('${OTHER}', 'b@x');`);
  });

  it("yeni kolonlarla satır eklenir", async () => {
    await db.exec(`insert into public.platform_audit_logs(actor_id, action, ip, user_agent, before, after)
      values ('${STAFF}', 'test.insert', '203.0.113.7', 'vitest', '{"a":1}', '{"a":2}')`);
    const { rows } = await db.query(`select ip, user_agent, before->>'a' as b, after->>'a' as a from public.platform_audit_logs where action = 'test.insert'`);
    expect(rows[0]).toMatchObject({ ip: "203.0.113.7", user_agent: "vitest", b: "1", a: "2" });
  });

  it("UPDATE ile değiştirilemez", async () => {
    await expect(db.exec(`update public.platform_audit_logs set action = 'tampered' where action = 'test.insert'`)).rejects.toThrow(/yalniz eklenir/);
    await expect(db.exec(`update public.platform_audit_logs set meta = '{"x":1}'`)).rejects.toThrow(/UPDATE yasak/);
    // Doğrudan actor_id boşaltma da yasak (istisna yalnız FK eylemi içinden).
    await expect(db.exec(`update public.platform_audit_logs set actor_id = null`)).rejects.toThrow(/UPDATE yasak/);
    const { rows } = await db.query(`select count(*)::int as n from public.platform_audit_logs where action = 'tampered'`);
    expect(rows[0].n).toBe(0);
  });

  it("DELETE ve TRUNCATE yasak", async () => {
    await expect(db.exec(`delete from public.platform_audit_logs`)).rejects.toThrow(/DELETE yasak/);
    await expect(db.exec(`truncate public.platform_audit_logs`)).rejects.toThrow(/TRUNCATE yasak/);
    const { rows } = await db.query(`select count(*)::int as n from public.platform_audit_logs`);
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("personel silinince FK actor_id'yi boşaltabilir (satırın geri kalanı aynı)", async () => {
    await db.exec(`insert into public.platform_audit_logs(actor_id, action) values ('${OTHER}', 'test.fk')`);
    await db.exec(`delete from public.platform_staff where id = '${OTHER}'`);
    const { rows } = await db.query(`select actor_id, action from public.platform_audit_logs where action = 'test.fk'`);
    expect(rows).toEqual([{ actor_id: null, action: "test.fk" }]);
  });

  it("destek erişimi geçmişi gerekçe ve bilet no olmadan yazılmaz", async () => {
    const tenant = (await db.query(`insert into public.tenants(name) values ('Ofis') returning id`)).rows[0].id as string;
    const base = `insert into public.platform_impersonation_history(staff_id, target_tenant_id, auth_session_id, reason, ticket_id, expires_at)`;
    await expect(db.exec(`${base} values ('${STAFF}', '${tenant}', 's1', 'kısa', 'T-1', now() + interval '1 hour')`)).rejects.toThrow();
    await expect(db.exec(`${base} values ('${STAFF}', '${tenant}', 's1', 'Müşteri sorunu inceleniyor', ' ', now() + interval '1 hour')`)).rejects.toThrow();
    await db.exec(`${base} values ('${STAFF}', '${tenant}', 's1', 'Müşteri sorunu inceleniyor', 'T-1', now() + interval '1 hour')`);
    const { rows } = await db.query(`select count(*)::int as n from public.platform_impersonation_history`);
    expect(rows[0].n).toBe(1);
  });

  it("oturum RPC'leri yalnız service_role ve yalnız personel oturumu kapatır", async () => {
    await db.exec(`insert into auth.users values ('33333333-3333-4333-8333-333333333333');
      insert into auth.sessions(id, user_id, ip, user_agent) values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${STAFF}', '198.51.100.1', 'tarayıcı'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '33333333-3333-4333-8333-333333333333', null, null);`);
    await expect(db.query(`select * from public.platform_list_staff_sessions()`)).rejects.toThrow(/Service role/);
    await db.exec(`set t.role = 'service_role'`);
    const list = await db.query(`select session_id, ip from public.platform_list_staff_sessions()`);
    expect(list.rows).toEqual([{ session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ip: "198.51.100.1" }]);
    const other = await db.query(`select public.platform_revoke_staff_session('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as ok`);
    expect(other.rows[0].ok).toBe(false);
    const own = await db.query(`select public.platform_revoke_staff_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as ok`);
    expect(own.rows[0].ok).toBe(true);
    await db.exec(`reset t.role`);
  });
});
