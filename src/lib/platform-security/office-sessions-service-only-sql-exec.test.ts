import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261027010100 — ofis oturumu RPC'leri YALNIZ service_role (SEC-2/F3) ve dört göz izni
 * eylemle AYNI transaction'da tüketilir (F10). Kanıtlanan:
 *  - üç fonksiyonda authenticated/anon EXECUTE yok, service_role var (has_function_privilege);
 *  - personel p_actor_staff_id ile SQL'de yeniden denetlenir (destek/muhasebe/pasif personel reddedilir);
 *  - başarılı kapatma TAM BİR platform denetim satırı yazar; izin verilmişse 'executed' olur;
 *  - kapatma hata verirse (oturum yok) izin 'approved' kalır ve yeniden kullanılabilir; yanlış/başkasının izni ES403;
 *  - peek tüketmez; release tüketilen izni geri bırakır; liste demo/test ofislerini gizleyebilir;
 *  - geri alma 20261025010000 imzalarına döner.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const SUPER_A = "11111111-1111-4111-8111-111111111111";
const SUPER_B = "22222222-2222-4222-8222-222222222222";
const OPS = "33333333-3333-4333-8333-333333333333";
const SUPPORT = "44444444-4444-4444-8444-444444444444";
const OFFICE_USER = "66666666-6666-4666-8666-666666666666";
const DEMO_USER = "77777777-7777-4777-8777-777777777777";
const TENANT = "88888888-8888-4888-8888-888888888888";
const DEMO_TENANT = "99999999-9999-4999-8999-999999999999";
const SESS1 = "a1111111-1111-4111-8111-111111111111";
const SESS2 = "a2222222-2222-4222-8222-222222222222";
const SESS_DEMO = "a3333333-3333-4333-8333-333333333333";
const MISSING = "a9999999-9999-4999-8999-999999999999";

const DG1 = "supabase/migrations/20261014001300_platform_custom_roles_four_eyes.sql";
const AG1 = "supabase/migrations/20261025010000_admin_sensitive_four_eyes_office_sessions.sql";
const MIG = "supabase/migrations/20261027010100_office_session_rpcs_service_only.sql";
const RB = "supabase/rollbacks/20261027010100_office_session_rpcs_service_only.rollback.sql";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
grant usage on schema auth, public to authenticated, anon, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table public.platform_staff(id uuid primary key, email text not null, full_name text not null default 'x',
  role text not null default 'support' check (role in ('super_admin','ops','support','billing')), is_active boolean not null default true,
  updated_at timestamptz default now());
create function public.is_platform_staff() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.platform_staff where id = auth.uid() and is_active) $$;
create function public.platform_staff_can(p_staff_id uuid, p_module text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case
    when s.role = 'super_admin' then p_action in ('view','write','approve')
    when s.role = 'ops' and p_module in ('members','sistem','tenants') then p_action in ('view','write')
    when s.role = 'support' and p_module in ('members','tenants') then p_action in ('view','write')
    else false end
  from public.platform_staff s where s.id = p_staff_id and s.is_active), false) $$;
create table public.tenants(id uuid primary key, name text, is_internal boolean not null default false);
create table public.profiles(id uuid primary key, tenant_id uuid, full_name text, role text, is_active boolean not null default true);
create table public.two_factor_verified_sessions(session_id text not null, user_id uuid not null, verified_at timestamptz default now());
create table public.login_challenges(id uuid primary key default gen_random_uuid(), user_id uuid not null);
create table auth.sessions(id uuid primary key, user_id uuid not null, created_at timestamptz default now(), updated_at timestamptz default now(),
  factor_id uuid, aal text, not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text, refresh_token_hmac_key text);
create table auth.refresh_tokens(id bigserial primary key, token varchar(255), user_id varchar(255), revoked boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(), parent varchar(255),
  session_id uuid references auth.sessions(id) on delete cascade);
create table public.platform_audit_logs(id uuid primary key default gen_random_uuid(), actor_id uuid, action text not null, entity_type text,
  entity_id uuid, meta jsonb, created_at timestamptz not null default now(), ip text, user_agent text, before jsonb, after jsonb);
`;

const SEED = `
insert into public.platform_staff(id, email, role) values
  ('${SUPER_A}', 'a@x', 'super_admin'), ('${SUPER_B}', 'b@x', 'super_admin'), ('${OPS}', 'o@x', 'ops'), ('${SUPPORT}', 's@x', 'support');
insert into public.tenants values ('${TENANT}', 'Kadıköy Emlak', false), ('${DEMO_TENANT}', 'Demo Emlak Ofisi', true);
insert into public.profiles(id, tenant_id, full_name, role) values
  ('${OFFICE_USER}', '${TENANT}', 'Ayşe Danışman', 'advisor'), ('${DEMO_USER}', '${DEMO_TENANT}', 'Demo Sahip', 'owner');
insert into auth.sessions(id, user_id, aal, user_agent, ip) values
  ('${SESS1}', '${OFFICE_USER}', 'aal2', 'Chrome', '85.105.12.34'), ('${SESS2}', '${OFFICE_USER}', 'aal1', 'Safari', '85.105.12.35'),
  ('${SESS_DEMO}', '${DEMO_USER}', 'aal1', 'node', '10.0.0.1');
insert into auth.refresh_tokens(token, user_id, session_id) values
  ('T1', '${OFFICE_USER}', '${SESS1}'), ('T2', '${OFFICE_USER}', '${SESS2}'), ('T3', '${DEMO_USER}', '${SESS_DEMO}');
`;

const FNS = [
  "public.platform_list_office_sessions(uuid,uuid,uuid,integer,boolean)",
  "public.platform_revoke_office_session(uuid,uuid,text,uuid,text,text)",
  "public.platform_revoke_office_user_sessions(uuid,uuid,text,uuid,text,text)",
  "public.platform_peek_approval(text,text,text,uuid,jsonb)",
  "public.platform_release_approval(uuid,uuid,text)",
];

describe.skipIf(!mod)("ofis oturumu RPC'leri yalnız service_role + atomik dört göz (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const audits = async () => Number((await one(`select count(*)::int n from public.platform_audit_logs`)).n);
  const approved = async (entityType: string, entityId: string, payload: string, by = OPS) =>
    String((await one(`insert into public.platform_approval_requests(kind, module, entity_type, entity_id, summary, payload, requested_by, expires_at, status, decided_by, decided_at)
      values ('session_revoke', 'members', $1, $2, 'Oturum kapatma talebi', $3::jsonb, $4, now() + interval '1 day', 'approved', '${SUPER_B}', now()) returning id`, [entityType, entityId, payload, by])).id);
  const status = async (id: string) => String((await one(`select status from public.platform_approval_requests where id = $1`, [id])).status);

  beforeEach(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read(DG1));
    await db.exec(read(AG1));
    await db.exec(read(MIG));
    await db.exec(SEED);
  });

  it("EXECUTE: authenticated ve anon'da yok, service_role'da var; eski imzalar düştü", async () => {
    for (const f of FNS) {
      const r = await one(`select has_function_privilege('authenticated', $1, 'EXECUTE') a, has_function_privilege('anon', $1, 'EXECUTE') n,
        has_function_privilege('service_role', $1, 'EXECUTE') s`, [f]);
      expect(r, f).toEqual({ a: false, n: false, s: true });
    }
    const old = await one(`select to_regprocedure('public.platform_revoke_office_session(uuid)')::text a,
      to_regprocedure('public.platform_revoke_office_user_sessions(uuid)')::text b, to_regprocedure('public.platform_list_office_sessions(uuid,uuid,integer)')::text c,
      to_regprocedure('public.platform_office_session_operator()')::text d`);
    expect(old).toEqual({ a: null, b: null, c: null, d: null });
    await db.exec(`set role authenticated`);
    await expect(q(`select * from public.platform_revoke_office_session('${SESS1}', '${OPS}', 'Kayıp cihaz bildirimi')`)).rejects.toThrow(/permission denied/);
    await db.exec(`reset role`);
  });

  it("personel SQL'de yeniden denetlenir: destek, pasif operasyon ve gerekçesiz çağrı reddedilir", async () => {
    await expect(q(`select * from public.platform_revoke_office_session('${SESS1}', '${SUPPORT}', 'Kayıp cihaz bildirimi')`)).rejects.toThrow(/yetkisi/);
    await expect(q(`select * from public.platform_revoke_office_session('${SESS1}', null, 'Kayıp cihaz bildirimi')`)).rejects.toThrow(/yetkisi/);
    await expect(q(`select * from public.platform_revoke_office_session('${SESS1}', '${OPS}', 'kısa')`)).rejects.toThrow(/Gerekce/);
    await q(`update public.platform_staff set is_active = false where id = '${OPS}'`);
    await expect(q(`select public.platform_revoke_office_user_sessions('${OFFICE_USER}', '${OPS}', 'Şüpheli giriş bildirildi')`)).rejects.toThrow(/yetkisi/);
    await expect(q(`select * from public.platform_list_office_sessions(null)`)).rejects.toThrow(/members modulu/);
    expect(await audits()).toBe(0);
  });

  it("başarılı kapatma tam bir denetim satırı yazar; dört göz izni aynı transaction'da tüketilir", async () => {
    const appr = await approved("auth_session", SESS1, `{"session_id":"${SESS1}"}`);
    const r = await one(`select * from public.platform_revoke_office_session($1, $2, 'Kayıp cihaz bildirimi', $3, '85.1.1.1', 'Chrome')`, [SESS1, OPS, appr]);
    expect(r).toMatchObject({ user_id: OFFICE_USER, tenant_id: TENANT });
    expect(await status(appr)).toBe("executed");
    expect(await audits()).toBe(1);
    const a = await one(`select actor_id, action, entity_id, meta, ip from public.platform_audit_logs`);
    expect(a).toMatchObject({ actor_id: OPS, action: "platform_member.session_revoke_one", entity_id: OFFICE_USER, ip: "85.1.1.1" });
    expect(a.meta).toMatchObject({ reason: "Kayıp cihaz bildirimi", four_eyes_approval_id: appr, session: SESS1.slice(0, 8) });
    expect(Number((await one(`select count(*)::int n from auth.sessions where id = $1`, [SESS1])).n)).toBe(0);
    // İzin bir kez kullanılır
    await expect(q(`select * from public.platform_revoke_office_session($1, $2, 'Kayıp cihaz bildirimi', $3)`, [SESS2, OPS, appr])).rejects.toMatchObject({ code: "ES403" });
  });

  it("kapatma hata verirse izin 'approved' kalır ve yeniden kullanılabilir; başkasının ya da başka yükün izni ES403", async () => {
    const appr = await approved("auth_session", MISSING, `{"session_id":"${MISSING}"}`);
    await expect(q(`select * from public.platform_revoke_office_session($1, $2, 'Kayıp cihaz bildirimi', $3)`, [MISSING, OPS, appr])).rejects.toMatchObject({ code: "P0002" });
    expect(await status(appr)).toBe("approved");
    expect(await audits()).toBe(0);

    const userAppr = await approved("profile", OFFICE_USER, `{"id":"${OFFICE_USER}"}`);
    // Başka personel aynı izni kullanamaz; başka kullanıcının izni bu kullanıcıya uygulanamaz
    await expect(q(`select public.platform_revoke_office_user_sessions($1, $2, 'Şüpheli giriş bildirildi', $3)`, [OFFICE_USER, SUPER_A, userAppr])).rejects.toMatchObject({ code: "ES403" });
    await expect(q(`select public.platform_revoke_office_user_sessions($1, $2, 'Şüpheli giriş bildirildi', $3)`, [DEMO_USER, OPS, userAppr])).rejects.toMatchObject({ code: "ES403" });
    expect(Number((await one(`select count(*)::int n from auth.sessions where user_id = $1`, [OFFICE_USER])).n)).toBe(2);
    expect(await status(userAppr)).toBe("approved");
    const n = await one(`select public.platform_revoke_office_user_sessions($1, $2, 'Şüpheli giriş bildirildi', $3) n`, [OFFICE_USER, OPS, userAppr]);
    expect(n.n).toBe(2);
    expect(await status(userAppr)).toBe("executed");
    expect(await audits()).toBe(1);
  });

  it("peek tüketmez; release tüketilen izni geri bırakır (yalnız talep eden, yalnız executed)", async () => {
    const appr = await approved("profile", OFFICE_USER, `{"id":"${OFFICE_USER}"}`);
    const peek = await one(`select public.platform_peek_approval('session_revoke', 'profile', $1, $2, $3::jsonb) id`, [OFFICE_USER, OPS, `{"id":"${OFFICE_USER}"}`]);
    expect(peek.id).toBe(appr);
    expect(await status(appr)).toBe("approved");
    expect((await one(`select public.platform_peek_approval('session_revoke', 'profile', $1, $2, $3::jsonb) id`, [OFFICE_USER, OPS, `{"id":"baska"}`])).id).toBeNull();
    const used = await one(`select public.platform_consume_approval('session_revoke', 'profile', $1, $2, $3::jsonb) id`, [OFFICE_USER, OPS, `{"id":"${OFFICE_USER}"}`]);
    expect(used.id).toBe(appr);
    expect((await one(`select public.platform_release_approval($1, $2, 'deneme hatası') ok`, [appr, SUPER_A])).ok).toBe(false);
    expect((await one(`select public.platform_release_approval($1, $2, 'deneme hatası') ok`, [appr, OPS])).ok).toBe(true);
    const row = await one(`select status, executed_at, result_error from public.platform_approval_requests where id = $1`, [appr]);
    expect(row).toEqual({ status: "approved", executed_at: null, result_error: "deneme hatası" });
  });

  it("liste: personel denetimi + demo/test ofisi sunucuda gizlenebilir", async () => {
    const all = await q(`select session_id, tenant_internal from public.platform_list_office_sessions($1)`, [SUPPORT]);
    expect(all.map((r) => r.session_id).sort()).toEqual([SESS1, SESS2, SESS_DEMO].sort());
    const real = await q(`select session_id from public.platform_list_office_sessions($1, null, null, 300, true)`, [SUPPORT]);
    expect(real.map((r) => r.session_id).sort()).toEqual([SESS1, SESS2].sort());
  });

  it("geri alma 20261025010000 imzalarına döner", async () => {
    await db.exec(read(RB));
    const r = await one(`select to_regprocedure('public.platform_revoke_office_session(uuid)')::text a,
      to_regprocedure('public.platform_list_office_sessions(uuid,uuid,uuid,integer,boolean)')::text b,
      to_regprocedure('public.platform_peek_approval(text,text,text,uuid,jsonb)')::text c`);
    expect(r).toEqual({ a: "platform_revoke_office_session(uuid)", b: null, c: null });
  });
});
