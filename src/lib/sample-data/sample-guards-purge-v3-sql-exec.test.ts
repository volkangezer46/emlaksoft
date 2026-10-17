import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * PKG-1 — İŞLEVSEL SQL TESTİ (pglite; gerçek PL/pgSQL): 20261024020000 (purge v2) → 20261027010000 (is_sample + demo kilidi
 * kapıları) → 20261027010200 (purge v3, gerçek çocuk ön kontrolü). Şema sadeleştirilmiş taklittir; kimlik/yaşam döngüsü
 * tetikleyicileri canlıdaki gibi bağlanır ve "authenticated" gerçekten `set role` ile oynanır (PostgREST yazımı taklidi).
 * Kanıtlanan:
 *  (SEC-1/F4) is_sample bayrağı authenticated ile hiçbir tabloda değişmez (self-update dahil); service_role değiştirir;
 *             is_sample sütunu olan HER tabloda kapı tetikleyicisi var.
 *  (SEC-1)    örnek ekip profili ofis bağlamı (current_active_tenant_id) alamaz; gerçek profil alır.
 *  (SEC-4)    settings:edit sahibi bile demo kilidi alanlarını (real_use_at, sample_seed_override_*, sample_cleared_at,
 *             sample_pack) değiştiremez; service_role değiştirir.
 *  (F2)       örnek müşteri/portföye kaskatla bağlı GERÇEK kayıt (teklif, IYS onayı, yüklenmiş fotoğraf, yeni kaskat tablo)
 *             purge'ü ES409 ile durdurur ve listelenir; hiçbir şey silinmez. Türetilmiş tablo ve statik demo fotoğrafı durdurmaz.
 *  (v3)       oturumlu SAHİP yolu (authenticated) artık kimlik/yaşam döngüsü tetikleyicilerine takılmadan tamamlanır.
 *  Geri alma: tetikleyiciler ve yeni fonksiyonlar düşer, eski gövdeler döner.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const V2 = "supabase/migrations/20261024020000_demo_mode_lock_purge_v2.sql";
const M1 = "supabase/migrations/20261027010000_sample_flag_tenant_lock_guards.sql";
const M3 = "supabase/migrations/20261027010200_purge_v3_real_child_guard.sql";
const RB1 = "supabase/rollbacks/20261027010000_sample_flag_tenant_lock_guards.rollback.sql";
const RB3 = "supabase/rollbacks/20261027010200_purge_v3_real_child_guard.rollback.sql";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
grant usage on schema auth, public to authenticated, anon, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('t.jwt', true), ''), '{}')::jsonb $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
create table public.platform_staff(id uuid primary key, is_active boolean not null default true);
create function public.is_platform_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_staff ps where ps.id = auth.uid() and ps.is_active) $$;
create function public.current_session_two_factor_satisfied() returns boolean language sql stable as $$ select true $$;
create table public.platform_impersonation_sessions(staff_id uuid, auth_session_id text, target_tenant_id uuid, expires_at timestamptz);
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text, plan text default 'pro',
  status text default 'active', trial_ends_at timestamptz, team_size int, created_at timestamptz default now(), lead_capture_token text,
  sample_seeded_at timestamptz, sample_pack text, sample_cleared_at timestamptz, updated_at timestamptz);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), branch_id uuid,
  role text not null, full_name text, phone text, is_active boolean not null default true, two_factor_sms boolean default false,
  two_factor_version int default 0);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, is_sample boolean not null default false,
  deleted_at timestamptz, assigned_to uuid references public.profiles(id));
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, is_sample boolean not null default false,
  deleted_at timestamptz, assigned_to uuid references public.profiles(id));
create table public.property_media(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  property_id uuid not null references public.properties(id) on delete cascade, storage_path text, external_url text);
create table public.customer_demands(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id) on delete cascade, is_sample boolean not null default false);
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, customer_id uuid references public.customers(id),
  assigned_to uuid references public.profiles(id), is_sample boolean not null default false);
create table public.appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id), is_sample boolean not null default false);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id),
  property_id uuid references public.properties(id), is_sample boolean not null default false);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid references public.deals(id), is_sample boolean not null default false);
create table public.offers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade, is_sample boolean not null default false);
create table public.contracts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id) on delete set null, is_sample boolean not null default false);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id),
  deal_id uuid references public.deals(id) on delete restrict, is_sample boolean not null default false);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid references public.rentals(id));
create table public.calls(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id), is_sample boolean not null default false);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, is_sample boolean not null default false);
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid references public.profiles(id), is_sample boolean not null default false);
create table public.property_control_state(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id) on delete cascade, is_sample boolean not null default false);
create table public.campaigns(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text);
create table public.communications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id) on delete cascade, body text);
-- Kaskat çocuklar: kullanıcı içeriği (is_sample yok) + türetilmiş geçmiş (sayılmaz)
create table public.iys_consents(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid not null references public.customers(id) on delete cascade);
create table public.property_price_history(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  property_id uuid not null, foreign key (property_id) references public.properties(id) on delete cascade);
create function public.purge_tenant_sample_data(p_tenant_id uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
`;

/** Canlıdaki gibi bağlanan kimlik / yaşam döngüsü tetikleyicileri (fonksiyonları 20261027010000 tanımlar). */
const GUARD_TRIGGERS = `
create trigger trg_guard_profile_identity_fields before update on public.profiles for each row execute function public.guard_profile_identity_fields();
create trigger trg_guard_tenant_lifecycle_fields before update on public.tenants for each row execute function public.guard_tenant_lifecycle_fields();
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
`;

describe.skipIf(!mod)("PKG-1 is_sample / demo kilidi kapıları + purge v3 (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const asService = () => db.exec(`reset role; select set_config('t.jwt', '{"role":"service_role"}', false), set_config('t.uid', '', false);`);
  /** PostgREST oturumlu isteği: JWT rolü + gerçek `authenticated` veritabanı rolü. */
  const asUser = (uid: string, app: Record<string, string> = {}) =>
    db.exec(`reset role; select set_config('t.jwt', '${JSON.stringify({ role: "authenticated", app_metadata: app })}', false), set_config('t.uid', '${uid}', false); set role authenticated;`);
  const count = async (table: string, tenant: string, extra = "") => Number((await one(`select count(*)::int n from public.${table} where tenant_id = $1 ${extra}`, [tenant])).n);

  let T: string;
  let OWNER: string;
  let PERSONA: string;
  let SC: string; // örnek müşteri
  let SP: string; // örnek portföy

  beforeEach(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read(V2));
    await db.exec(read(M1));
    await db.exec(read(M3));
    await db.exec(GUARD_TRIGGERS);
    await asService();
    T = String((await one(`insert into public.tenants(slug, name, sample_seeded_at, sample_pack) values ('yeni-ofis', 'Yeni Ofis', now(), 'konut') returning id`)).id);
    OWNER = String((await one(`insert into public.profiles(tenant_id, role, full_name) values ($1, 'owner', 'Sahip') returning id`, [T])).id);
    PERSONA = String((await one(`insert into public.profiles(tenant_id, role, full_name, is_sample) values ($1, 'advisor', 'Burak Şen', true) returning id`, [T])).id);
    SC = String((await one(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Selin Aksoy', true) returning id`, [T])).id);
    SP = String((await one(`insert into public.properties(tenant_id, title, is_sample) values ($1, 'Kadıköy 3+1', true) returning id`, [T])).id);
    await q(`insert into public.property_media(tenant_id, property_id, storage_path, external_url) values ($1, $2, null, '/img/demo/set-1/a-1600.webp')`, [T, SP]);
    await q(`insert into public.property_price_history(tenant_id, property_id) values ($1, $2)`, [T, SP]);
    await q(`insert into public.offers(tenant_id, property_id, customer_id, is_sample) values ($1, $2, $3, true)`, [T, SP, SC]);
    await q(`insert into public.deals(tenant_id, customer_id, property_id, is_sample) values ($1, $2, $3, true)`, [T, SC, SP]);
    await q(`insert into public.tasks(tenant_id, title, customer_id, is_sample) values ($1, 'Ara', $2, true)`, [T, SC]);
  });

  it("SEC-1/F4: is_sample authenticated ile hiçbir tabloda değişmez; service_role değiştirir", async () => {
    const realC = String((await one(`insert into public.customers(tenant_id, full_name) values ($1, 'Gerçek') returning id`, [T])).id);
    await asUser(OWNER);
    await expect(q(`update public.customers set is_sample = true where id = $1`, [realC])).rejects.toThrow(/is_sample/);
    await expect(q(`update public.properties set is_sample = false where id = $1`, [SP])).rejects.toThrow(/is_sample/);
    await expect(q(`update public.deals set is_sample = false where tenant_id = $1`, [T])).rejects.toThrow(/is_sample/);
    await expect(q(`update public.tasks set is_sample = false where tenant_id = $1`, [T])).rejects.toThrow(/is_sample/);
    // Kendi profilini örnek işaretleyip koltuk sayımından düşme (self-update) ve ekip profili değiştirme
    await expect(q(`update public.profiles set is_sample = true where id = $1`, [OWNER])).rejects.toThrow(/42501|is_sample|Identity/);
    await expect(q(`update public.profiles set is_sample = false where id = $1`, [PERSONA])).rejects.toThrow(/42501|is_sample|Identity/);
    // Bayrağa dokunmayan güncelleme serbest
    await q(`update public.customers set full_name = 'Gerçek 2' where id = $1`, [realC]);
    await asService();
    expect((await one(`select is_sample from public.customers where id = $1`, [realC])).is_sample).toBe(false);
    await q(`update public.customers set is_sample = true where id = $1`, [realC]);
    expect((await one(`select is_sample from public.customers where id = $1`, [realC])).is_sample).toBe(true);
  });

  it("is_sample sütunu olan HER tabloda kapı tetikleyicisi var (yalnız UPDATE OF is_sample)", async () => {
    const missing = await q(`
      select c.relname from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'is_sample' and not a.attisdropped
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'trg_00_sample_flag_guard')`);
    expect(missing).toEqual([]);
    const n = Number((await one(`select count(*)::int n from pg_trigger where tgname = 'trg_00_sample_flag_guard'`)).n);
    expect(n).toBeGreaterThanOrEqual(15);
  });

  it("SEC-1: örnek ekip profili ofis bağlamı alamaz; gerçek profil alır", async () => {
    await asUser(PERSONA, { tenant_id: T, role: "advisor" });
    expect((await one(`select public.current_active_tenant_id() t`)).t).toBeNull();
    await asUser(OWNER, { tenant_id: T, role: "owner" });
    expect((await one(`select public.current_active_tenant_id() t`)).t).toBe(T);
  });

  it("SEC-4: settings:edit sahibi demo kilidi alanlarını değiştiremez; diğer alanlar ve service_role serbest", async () => {
    await asUser(OWNER);
    const forged = "99999999-9999-4999-8999-999999999999";
    await expect(q(`update public.tenants set sample_seed_override_until = now() + interval '1 day', sample_seed_override_by = $2 where id = $1`, [T, forged])).rejects.toThrow(/Demo kilidi/);
    await expect(q(`update public.tenants set real_use_at = now() where id = $1`, [T])).rejects.toThrow(/Demo kilidi/);
    await expect(q(`update public.tenants set sample_cleared_at = now() where id = $1`, [T])).rejects.toThrow(/Demo kilidi/);
    await expect(q(`update public.tenants set sample_pack = 'arsa' where id = $1`, [T])).rejects.toThrow(/Demo kilidi/);
    await expect(q(`update public.tenants set sample_seeded_at = null where id = $1`, [T])).rejects.toThrow(/lifecycle/);
    await q(`update public.tenants set name = 'Yeni Ad' where id = $1`, [T]);
    // Doğrudan GUC kurmak da işe yaramaz: güvenilir işaret yalnız DEFINER gövdesinde (current_user authenticated değilken) geçerli.
    await db.exec(`select set_config('app.sample_trusted_tenant', '${T}', false)`);
    await expect(q(`update public.tenants set real_use_at = now() where id = $1`, [T])).rejects.toThrow(/Demo kilidi/);
    await expect(q(`update public.customers set is_sample = false where id = $1`, [SC])).rejects.toThrow(/is_sample/);
    await db.exec(`select set_config('app.sample_trusted_tenant', '', false)`);
    await asService();
    await q(`update public.tenants set sample_seed_override_until = now() + interval '10 minutes', sample_seed_override_by = $2 where id = $1`, [T, forged]);
  });

  it("F2: örnek ebeveyne bağlı GERÇEK teklif/IYS onayı/yüklenmiş fotoğraf purge'ü ES409 ile durdurur ve listelenir; hiçbir şey silinmez", async () => {
    await q(`insert into public.offers(tenant_id, property_id, is_sample) values ($1, $2, false)`, [T, SP]);
    await q(`insert into public.iys_consents(tenant_id, customer_id) values ($1, $2)`, [T, SC]);
    await q(`insert into public.property_media(tenant_id, property_id, storage_path) values ($1, $2, $3)`, [T, SP, `${T}/${SP}/gercek.webp`]);
    const pre = (await one(`select public.purge_sample_real_children($1) r`, [T])).r as {
      total: number;
      tables: { table: string; parent: string; count: number }[];
      rows: { table: string; parent_label: string }[];
    };
    expect(pre.total).toBe(3);
    expect(pre.tables.map((t) => t.table).sort()).toEqual(["iys_consents", "offers", "property_media"]);
    expect(pre.rows.find((r) => r.table === "offers")?.parent_label).toBe("Kadıköy 3+1");
    expect(pre.rows.find((r) => r.table === "iys_consents")?.parent_label).toBe("Selin Aksoy");

    await asUser(OWNER);
    let err: { code?: string; detail?: string } | null = null;
    try {
      await q(`select public.purge_tenant_sample_data($1)`, [T]);
    } catch (e) {
      err = e as { code?: string; detail?: string };
    }
    expect(err?.code).toBe("ES409");
    expect(JSON.parse(String(err?.detail)).total).toBe(3);
    await asService();
    expect(await count("customers", T, "and is_sample")).toBe(1);
    expect(await count("properties", T, "and is_sample")).toBe(1);
    expect(await count("offers", T)).toBe(2);
    expect((await one(`select real_use_at from public.tenants where id = $1`, [T])).real_use_at).toBeNull();
  });

  it("F2: yeni eklenen kaskat tablo (is_sample yok) güvenli varsayılanla gerçek sayılır; türetilmiş geçmiş ve statik fotoğraf sayılmaz", async () => {
    expect(((await one(`select public.purge_sample_real_children($1) r`, [T])).r as { total: number }).total).toBe(0);
    await db.exec(`create table public.yeni_modul(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      customer_id uuid not null, foreign key (customer_id) references public.customers(id) on delete cascade)`);
    await q(`insert into public.yeni_modul(tenant_id, customer_id) values ($1, $2)`, [T, SC]);
    const r = (await one(`select public.purge_sample_real_children($1) r`, [T])).r as { total: number; tables: { table: string }[] };
    expect(r).toMatchObject({ total: 1, tables: [{ table: "yeni_modul" }] });
  });

  it("v3: oturumlu SAHİP yolu tamamlanır (damga + örnek ekip pasifleştirme tetikleyicilere takılmaz), gerçek kayıt kalır", async () => {
    const realC = String((await one(`insert into public.customers(tenant_id, full_name) values ($1, 'Gerçek') returning id`, [T])).id);
    await q(`insert into public.tasks(tenant_id, title, assigned_to) values ($1, 'Gerçek görev', $2)`, [T, PERSONA]); // persona gerçek kayda bağlı → pasif kalır
    await asUser(OWNER);
    const r = (await one(`select public.purge_tenant_sample_data($1) r`, [T])).r as { personas_kept: string[]; deleted: Record<string, number> };
    await asService();
    expect(r.personas_kept).toEqual([PERSONA]);
    expect((await one(`select is_active from public.profiles where id = $1`, [PERSONA])).is_active).toBe(false);
    expect((await one(`select is_active from public.profiles where id = $1`, [OWNER])).is_active).toBe(true);
    expect(await count("customers", T)).toBe(1);
    expect((await one(`select id from public.customers where tenant_id = $1`, [T])).id).toBe(realC);
    expect(await count("property_price_history", T)).toBe(0); // türetilmiş: ebeveynle düştü
    const t = await one(`select real_use_at, sample_seeded_at, sample_pack from public.tenants where id = $1`, [T]);
    expect(t.real_use_at).not.toBeNull();
    expect(t.sample_seeded_at).toBeNull();
    expect(t.sample_pack).toBeNull();
    // İşaret transaction sonunda kalmaz: aynı oturumda doğrudan yazım yine reddedilir.
    await asUser(OWNER);
    await expect(q(`update public.tenants set real_use_at = now() where id = $1`, [T])).rejects.toThrow(/Demo kilidi/);
  });

  it("geri alma: tetikleyiciler ve yeni fonksiyonlar düşer; is_sample yeniden yazılabilir (eski davranış)", async () => {
    await db.exec(read(RB3));
    await db.exec(read(RB1));
    const left = await q(`select count(*)::int n from pg_trigger where tgname = 'trg_00_sample_flag_guard'`);
    expect(left[0]!.n).toBe(0);
    const fns = await one(`select to_regprocedure('public.sample_trusted_op(uuid)')::text a, to_regprocedure('public.purge_sample_real_children(uuid)')::text b,
      to_regprocedure('public.guard_sample_flag_update()')::text c`);
    expect(fns).toEqual({ a: null, b: null, c: null });
    await asUser(OWNER);
    await q(`update public.customers set is_sample = false where id = $1`, [SC]);
  });
});
