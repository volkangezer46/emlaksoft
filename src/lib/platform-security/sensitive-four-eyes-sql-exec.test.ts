import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261025010000 — hassas admin işlemleri dört göz izni ve ofis oturumları.
 *  - platform_consume_approval: onaylı izin TEK SEFER tüketilir; yük farklıysa, başka personel, süresi geçmiş, onaylayan
 *    süper admin değilse ya da eski (yürütme) türündeyse tüketilmez. Yalnız service_role çalıştırır.
 *  - platform_list_office_sessions: yalnız members modülünü gören aktif personel; IP maskeli; belirteç/HMAC sütunu yok;
 *    personel oturumu ve tüm refresh token'ı iptal edilmiş oturum listelenmez.
 *  - platform_revoke_office_session / _user_sessions: yalnız members:write + süper admin / operasyon; yalnız ofis kullanıcısı.
 *  - Geri alma temiz düşürür.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const SUPER_A = "11111111-1111-4111-8111-111111111111";
const SUPER_B = "22222222-2222-4222-8222-222222222222";
const OPS = "33333333-3333-4333-8333-333333333333";
const SUPPORT = "44444444-4444-4444-8444-444444444444";
const BILLING = "55555555-5555-4555-8555-555555555555";
const OFFICE_USER = "66666666-6666-4666-8666-666666666666";
const OFFICE_USER2 = "77777777-7777-4777-8777-777777777777";
const TENANT = "88888888-8888-4888-8888-888888888888";
const SESS1 = "a1111111-1111-4111-8111-111111111111";
const SESS2 = "a2222222-2222-4222-8222-222222222222";
const SESS_DEAD = "a3333333-3333-4333-8333-333333333333";
const SESS_STAFF = "a4444444-4444-4444-8444-444444444444";
const SESS_U2 = "a5555555-5555-4555-8555-555555555555";

const DG1 = "supabase/migrations/20261014001300_platform_custom_roles_four_eyes.sql";
const MIG = "supabase/migrations/20261025010000_admin_sensitive_four_eyes_office_sessions.sql";
const RB = "supabase/rollbacks/20261025010000_admin_sensitive_four_eyes_office_sessions.rollback.sql";

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
-- Sabit rol matrisinin members/sistem kesiti (20261014021010 platform_fixed_role_actions ile aynı sonuç).
create function public.platform_staff_can(p_staff_id uuid, p_module text, p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select case
    when s.role = 'super_admin' then p_action in ('view','write','approve')
    when s.role = 'ops' and p_module in ('members','sistem','tenants') then p_action in ('view','write')
    when s.role = 'support' and p_module in ('members','tenants') then p_action in ('view','write')
    when s.role = 'billing' and p_module in ('billing','tenants') then p_action in ('view','write')
    else false end
  from public.platform_staff s where s.id = p_staff_id and s.is_active), false) $$;
create table public.tenants(id uuid primary key, name text);
create table public.profiles(id uuid primary key, tenant_id uuid, full_name text, role text, is_active boolean not null default true);
create table public.two_factor_verified_sessions(session_id text not null, user_id uuid not null, verified_at timestamptz default now());
create table public.login_challenges(id uuid primary key default gen_random_uuid(), user_id uuid not null);
create table auth.sessions(id uuid primary key, user_id uuid not null, created_at timestamptz default now(), updated_at timestamptz default now(),
  factor_id uuid, aal text, not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text, refresh_token_hmac_key text);
create table auth.refresh_tokens(id bigserial primary key, token varchar(255), user_id varchar(255), revoked boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(), parent varchar(255),
  session_id uuid references auth.sessions(id) on delete cascade);
`;

const SEED = `
insert into public.platform_staff(id, email, role) values
  ('${SUPER_A}', 'a@x', 'super_admin'), ('${SUPER_B}', 'b@x', 'super_admin'), ('${OPS}', 'o@x', 'ops'),
  ('${SUPPORT}', 's@x', 'support'), ('${BILLING}', 'f@x', 'billing');
insert into public.tenants values ('${TENANT}', 'Kadıköy Emlak');
insert into public.profiles(id, tenant_id, full_name, role) values
  ('${OFFICE_USER}', '${TENANT}', 'Ayşe Danışman', 'advisor'), ('${OFFICE_USER2}', '${TENANT}', 'Mehmet Sahip', 'owner'),
  ('${OPS}', '${TENANT}', 'Personel Profili', 'owner');
insert into auth.sessions(id, user_id, aal, user_agent, ip, refresh_token_hmac_key, updated_at) values
  ('${SESS1}', '${OFFICE_USER}', 'aal2', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', '85.105.12.34', 'GIZLI-HMAC', now() - interval '1 hour'),
  ('${SESS2}', '${OFFICE_USER}', 'aal1', 'Mozilla/5.0 (iPhone) Safari/604', '2a02:e0:1234:5678::1', 'GIZLI-HMAC', now() - interval '2 hour'),
  ('${SESS_DEAD}', '${OFFICE_USER}', 'aal1', 'x', '10.0.0.1', 'GIZLI-HMAC', now()),
  ('${SESS_STAFF}', '${OPS}', 'aal2', 'x', '10.0.0.2', 'GIZLI-HMAC', now()),
  ('${SESS_U2}', '${OFFICE_USER2}', 'aal1', 'x', '10.0.0.3', 'GIZLI-HMAC', now());
insert into auth.refresh_tokens(token, user_id, revoked, session_id) values
  ('TOKEN-1', '${OFFICE_USER}', false, '${SESS1}'), ('TOKEN-2', '${OFFICE_USER}', false, '${SESS2}'),
  ('TOKEN-3', '${OFFICE_USER}', true, '${SESS_DEAD}'), ('TOKEN-4', '${OPS}', false, '${SESS_STAFF}'),
  ('TOKEN-5', '${OFFICE_USER2}', false, '${SESS_U2}');
insert into public.two_factor_verified_sessions(session_id, user_id) values ('${SESS1}', '${OFFICE_USER}');
insert into public.login_challenges(user_id) values ('${OFFICE_USER2}');
`;

describe.skipIf(!mod)("AG1 hassas dört göz + ofis oturumları (pglite)", () => {
  let db: Db;
  const q = async (sql: string) => (await db.query(sql)).rows;
  const as = async (uid: string | null) => {
    await db.exec(`reset role;`);
    await db.exec(`select set_config('t.uid', '${uid ?? ""}', false);`);
    await db.exec(`set role authenticated;`);
  };
  const asOwner = () => db.exec(`reset role; select set_config('t.uid', '', false);`);

  const approved = async (opts: { kind?: string; entity?: string; by?: string; decider?: string; payload?: string; expires?: string } = {}) => {
    const kind = opts.kind ?? "session_revoke";
    const mod2 = kind === "refund" ? "billing" : kind === "flag_change" || kind === "queue_requeue" ? "sistem" : kind === "session_revoke" ? "members" : "tenants";
    const rows = await q(`insert into public.platform_approval_requests(kind, module, entity_type, entity_id, summary, payload, requested_by, expires_at, status, decided_by, decided_at)
      values ('${kind}', '${mod2}', 'profile', '${opts.entity ?? OFFICE_USER}', 'Oturum kapatma talebi', '${opts.payload ?? `{"id":"${OFFICE_USER}"}`}'::jsonb,
        '${opts.by ?? OPS}', ${opts.expires ?? "now() + interval '1 day'"}, 'approved', '${opts.decider ?? SUPER_B}', now()) returning id`);
    return rows[0]!.id as string;
  };
  const consume = async (by: string, payload = `{"id":"${OFFICE_USER}"}`, kind = "session_revoke", entity = OFFICE_USER) =>
    (await q(`select public.platform_consume_approval('${kind}', 'profile', '${entity}', '${by}', '${payload}'::jsonb) as id`))[0]!.id as string | null;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read(DG1));
    await db.exec(read(MIG));
    await db.exec(SEED);
  });

  it("onaylı izin tam bir kez tüketilir (approved -> executed); ikinci çağrı null", async () => {
    const id = await approved();
    expect(await consume(OPS)).toBe(id);
    const [row] = await q(`select status, executed_at from public.platform_approval_requests where id = '${id}'`);
    expect(row!.status).toBe("executed");
    expect(row!.executed_at).not.toBeNull();
    expect(await consume(OPS)).toBeNull();
  });

  it("iki onaylı izin varsa her çağrı yalnız birini tüketir", async () => {
    const e = "u-two";
    const p = `{"id":"${e}"}`;
    const first = await approved({ entity: e, payload: p });
    const second = await approved({ entity: e, payload: p });
    const a = await consume(OPS, p, "session_revoke", e);
    const b = await consume(OPS, p, "session_revoke", e);
    expect(new Set([a, b])).toEqual(new Set([first, second]));
    expect(await consume(OPS, p, "session_revoke", e)).toBeNull();
  });

  it("yük farklı, başka personel, süresi geçmiş, onaylayan süper admin değil ya da eski tür: tüketilmez", async () => {
    await approved({ entity: "u-pay", payload: `{"id":"u-pay"}` });
    expect(await consume(OPS, `{"id":"baska"}`, "session_revoke", "u-pay")).toBeNull();
    expect(await consume(SUPPORT, `{"id":"u-pay"}`, "session_revoke", "u-pay")).toBeNull();
    expect(await consume(OPS, `{"id":"u-pay"}`, "session_revoke", "u-pay")).not.toBeNull();

    await approved({ entity: "u-exp", payload: `{"id":"u-exp"}`, expires: "now() - interval '1 minute'" });
    expect(await consume(OPS, `{"id":"u-exp"}`, "session_revoke", "u-exp")).toBeNull();

    await approved({ entity: "u-ops", payload: `{"id":"u-ops"}`, decider: SUPPORT });
    expect(await consume(OPS, `{"id":"u-ops"}`, "session_revoke", "u-ops")).toBeNull();

    await q(`insert into public.platform_approval_requests(kind, module, entity_type, entity_id, summary, payload, requested_by, expires_at, status, decided_by, decided_at)
      values ('refund', 'billing', 'profile', 'u-old', 'İade talebi', '{}'::jsonb, '${OPS}', now() + interval '1 day', 'approved', '${SUPER_B}', now())`);
    expect(await consume(OPS, `{}`, "refund", "u-old")).toBeNull();
  });

  it("bekleyen talep izin değildir; talep eden kendi talebini onaylayamaz (CHECK)", async () => {
    const [p] = await q(`insert into public.platform_approval_requests(kind, module, entity_type, entity_id, summary, payload, requested_by, expires_at)
      values ('impersonation', 'tenants', 'profile', 'u-pend', 'Ofise giriş', '{"id":"u-pend"}'::jsonb, '${SUPER_A}', now() + interval '1 day') returning id`);
    expect(await consume(SUPER_A, `{"id":"u-pend"}`, "impersonation", "u-pend")).toBeNull();
    await expect(db.exec(`update public.platform_approval_requests set status='approved', decided_by='${SUPER_A}', decided_at=now() where id='${p!.id}'`)).rejects.toThrow(/platform_approval_four_eyes/);
  });

  it("tüketim fonksiyonu authenticated'a kapalı", async () => {
    await as(SUPER_A);
    await expect(db.query(`select public.platform_consume_approval('session_revoke','profile','x','${SUPER_A}','{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    await asOwner();
  });

  it("oturum listesi: members görmeyen personel ve ofis kullanıcısı reddedilir", async () => {
    for (const uid of [BILLING, OFFICE_USER, null]) {
      await as(uid);
      await expect(db.query(`select * from public.platform_list_office_sessions()`)).rejects.toThrow(/members modulu gerekli/);
    }
    await asOwner();
  });

  it("oturum listesi: destek görür; IP maskeli, belirteç sütunu yok, personel ve ölü oturum yok", async () => {
    await as(SUPPORT);
    const rows = await q(`select * from public.platform_list_office_sessions()`);
    await asOwner();
    const ids = rows.map((r) => r.session_id);
    expect(ids).toEqual(expect.arrayContaining([SESS1, SESS2, SESS_U2]));
    expect(ids).not.toContain(SESS_DEAD);
    expect(ids).not.toContain(SESS_STAFF);
    const s1 = rows.find((r) => r.session_id === SESS1)!;
    expect(s1.ip_masked).toBe("85.105.x.x");
    expect(rows.find((r) => r.session_id === SESS2)!.ip_masked).toBe("2a02:e0:x:x");
    expect(s1).toMatchObject({ full_name: "Ayşe Danışman", role: "advisor", tenant_name: "Kadıköy Emlak", aal: "aal2" });
    const blob = JSON.stringify(rows);
    expect(blob).not.toMatch(/TOKEN-|GIZLI-HMAC|85\.105\.12\.34/);
    expect(Object.keys(s1)).not.toEqual(expect.arrayContaining(["token"]));
  });

  it("tek oturum kapatma: destek ve muhasebe reddedilir; operasyon kapatır (2FA kaydı ve refresh token düşer)", async () => {
    for (const uid of [SUPPORT, BILLING, OFFICE_USER]) {
      await as(uid);
      await expect(db.query(`select * from public.platform_revoke_office_session('${SESS1}')`)).rejects.toThrow(/yetkisi/);
    }
    await as(OPS);
    await expect(db.query(`select * from public.platform_revoke_office_session('${SESS_STAFF}')`)).rejects.toThrow(/bulunamadi/);
    const [r] = await q(`select * from public.platform_revoke_office_session('${SESS1}')`);
    await asOwner();
    expect(r).toMatchObject({ user_id: OFFICE_USER, tenant_id: TENANT });
    expect((await q(`select count(*)::int n from auth.sessions where id = '${SESS1}'`))[0]!.n).toBe(0);
    expect((await q(`select count(*)::int n from auth.refresh_tokens where session_id = '${SESS1}'`))[0]!.n).toBe(0);
    expect((await q(`select count(*)::int n from public.two_factor_verified_sessions where session_id = '${SESS1}'`))[0]!.n).toBe(0);
    expect((await q(`select count(*)::int n from auth.sessions where id = '${SESS2}'`))[0]!.n).toBe(1);
  });

  it("tüm oturumları kapatma: yalnız süper admin / operasyon; personel hedeflenemez", async () => {
    await as(SUPPORT);
    await expect(db.query(`select public.platform_revoke_office_user_sessions('${OFFICE_USER2}')`)).rejects.toThrow(/yetkisi/);
    await as(SUPER_A);
    await expect(db.query(`select public.platform_revoke_office_user_sessions('${OPS}')`)).rejects.toThrow(/bulunamadi/);
    const [r] = await q(`select public.platform_revoke_office_user_sessions('${OFFICE_USER2}') as n`);
    await asOwner();
    expect(r!.n).toBe(1);
    expect((await q(`select count(*)::int n from public.login_challenges where user_id = '${OFFICE_USER2}'`))[0]!.n).toBe(0);
    expect((await q(`select count(*)::int n from auth.sessions where id = '${SESS_STAFF}'`))[0]!.n).toBe(1);
  });

  it("geri alma temiz düşürür; eski türler yine yazılır", async () => {
    const fresh = new mod!.PGlite();
    await fresh.exec(STUB);
    await fresh.exec(read(DG1));
    await fresh.exec(read(MIG));
    await fresh.exec(read(RB));
    const { rows } = await fresh.query(`select to_regprocedure('public.platform_consume_approval(text,text,text,uuid,jsonb)')::text as f,
      to_regprocedure('public.platform_list_office_sessions(uuid,uuid,integer)')::text as l`);
    expect(rows[0]).toMatchObject({ f: null, l: null });
    await fresh.exec(`insert into public.platform_staff(id, email, role) values ('${OPS}', 'o@x', 'ops')`);
    await expect(fresh.exec(`insert into public.platform_approval_requests(kind, module, entity_type, entity_id, summary, requested_by, expires_at)
      values ('session_revoke','members','profile','x','x x x','${OPS}', now())`)).rejects.toThrow(/kind_check/);
  });
});
