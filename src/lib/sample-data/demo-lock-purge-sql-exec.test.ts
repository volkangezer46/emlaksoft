import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * DM1 demo sistemi — İŞLEVSEL SQL TESTİ (pglite; migration 20261024020000 gerçek PL/pgSQL ile). Şema sadeleştirilmiş
 * taklittir. Kanıtlanan:
 *  (1) KİLİT: gerçek kullanıma geçmiş ofise ya da gerçek kaydı olan ofise is_sample=true müşteri/portföy EKLENEMEZ
 *      (tetikleyici); süper admin izni yalnız gerçek kaydı olmayan ofiste geçerli; genel demo ofisi kilit dışı.
 *  (2) purge v2 TÜM örnek varlıkları siler (modüller, kampanya, mesaj, fotoğraf satırı), gerçek kayıtlara dokunmaz.
 *  (3) Demo ekip: bağsız örnek profil silinir; gerçek kayda bağlı örnek profil pasif kalır; gerçek kullanıcı değişmez.
 *  (4) Purge sonrası yeniden tohum REDDEDİLİR (sample_seed_guard + tetikleyici); yetkisiz çağrı ve demo-ofis reddedilir.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('t.jwt', true), ''), '{}')::jsonb $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text, sample_seeded_at timestamptz,
  sample_pack text, sample_cleared_at timestamptz, updated_at timestamptz);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), role text not null,
  full_name text, is_active boolean not null default true);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, is_sample boolean not null default false,
  deleted_at timestamptz, assigned_to uuid references public.profiles(id));
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, is_sample boolean not null default false,
  deleted_at timestamptz, assigned_to uuid references public.profiles(id));
create table public.property_media(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  property_id uuid not null references public.properties(id) on delete cascade, storage_path text, external_url text);
create table public.customer_demands(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id), is_sample boolean not null default false);
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, customer_id uuid references public.customers(id),
  assigned_to uuid references public.profiles(id), is_sample boolean not null default false);
create table public.appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id), is_sample boolean not null default false);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id),
  property_id uuid references public.properties(id), is_sample boolean not null default false);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid references public.deals(id), is_sample boolean not null default false);
create table public.offers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id), is_sample boolean not null default false);
create table public.contracts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id) on delete set null, is_sample boolean not null default false);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id),
  deal_id uuid references public.deals(id) on delete restrict, is_sample boolean not null default false);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid references public.rentals(id));
create table public.calls(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id), is_sample boolean not null default false);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, is_sample boolean not null default false);
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid references public.profiles(id), is_sample boolean not null default false);
create table public.property_control_state(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id), is_sample boolean not null default false);
create table public.campaigns(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text);
create table public.communications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid references public.customers(id) on delete cascade, body text);
-- İsteğe bağlı modül tabloları (purge v2 dinamik adımları)
create table public.fsbo_leads(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, is_sample boolean not null default false);
create table public.buildings(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, notes text);
create table public.league_challenges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, description text);
create table public.finance_accounts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, is_sample boolean not null default false);
-- Kayıt modülleri (records-seed.ts): gerçek FK davranışıyla (dosya → talep kaskat, tutanak → kira kaskat, başvuru → bağlantı set null).
create table public.finance_budgets(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, category text, is_sample boolean not null default false);
create table public.document_requests(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  customer_id uuid references public.customers(id) on delete set null, property_id uuid references public.properties(id) on delete set null, is_sample boolean not null default false);
create table public.document_request_files(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  request_id uuid not null references public.document_requests(id) on delete cascade, storage_path text not null, is_sample boolean not null default false);
create table public.rental_application_links(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  property_id uuid not null references public.properties(id) on delete cascade, is_sample boolean not null default false);
create table public.rental_applications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  link_id uuid references public.rental_application_links(id) on delete set null, property_id uuid not null references public.properties(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null, rental_id uuid references public.rentals(id) on delete set null, is_sample boolean not null default false);
create table public.rental_inspections(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  rental_id uuid not null references public.rentals(id) on delete cascade, kind text not null, is_sample boolean not null default false);
create function public.purge_tenant_sample_data(p_tenant_id uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
`;

const SAMPLE_TABLES = ["customers", "properties", "customer_demands", "tasks", "appointments", "deals", "commissions", "offers", "contracts", "rentals", "calls", "expenses", "notifications", "property_control_state", "campaigns", "communications", "fsbo_leads", "finance_accounts",
  "finance_budgets", "document_requests", "document_request_files", "rental_application_links", "rental_applications", "rental_inspections"];

describe.skipIf(!mod)("DM1 kilit + purge v2 — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const asService = () => db.exec(`select set_config('t.jwt', '{"role":"service_role"}', false), set_config('t.uid', '', false)`);
  const asUser = (uid: string) => db.exec(`select set_config('t.jwt', '{"role":"authenticated"}', false), set_config('t.uid', '${uid}', false)`);
  const count = async (table: string, tenant: string, extra = "") => Number((await one(`select count(*)::int n from public.${table} where tenant_id = $1 ${extra}`, [tenant])).n);

  let T: string; // örnek veri yüklü yeni ofis
  let OWNER: string;
  let ADVISOR: string; // gerçek danışman
  let P1: string; // bağsız demo ekip üyesi
  let P2: string; // gerçek kayda bağlanmış demo ekip üyesi

  beforeEach(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261024020000_demo_mode_lock_purge_v2.sql"));
    await asService();
    T = String((await one(`insert into public.tenants(slug, name, sample_seeded_at, sample_pack) values ('yeni-ofis', 'Yeni Ofis', now(), 'konut') returning id`)).id);
    OWNER = String((await one(`insert into public.profiles(tenant_id, role, full_name) values ($1, 'owner', 'Sahip') returning id`, [T])).id);
    ADVISOR = String((await one(`insert into public.profiles(tenant_id, role, full_name) values ($1, 'advisor', 'Gerçek Danışman') returning id`, [T])).id);
    P1 = String((await one(`insert into public.profiles(tenant_id, role, full_name, is_sample) values ($1, 'advisor', 'Burak Şen', true) returning id`, [T])).id);
    P2 = String((await one(`insert into public.profiles(tenant_id, role, full_name, is_sample) values ($1, 'team_lead', 'Elif Yıldız', true) returning id`, [T])).id);
  });

  async function seedSample(tenant: string) {
    const c = String((await one(`insert into public.customers(tenant_id, full_name, is_sample, assigned_to) values ($1, 'Selin Aksoy', true, $2) returning id`, [tenant, P1])).id);
    const p = String((await one(`insert into public.properties(tenant_id, title, is_sample, assigned_to) values ($1, 'Kadıköy 3+1', true, $2) returning id`, [tenant, P2])).id);
    await q(`insert into public.property_media(tenant_id, property_id, storage_path, external_url) values ($1, $2, null, '/img/demo/set-1/a-1-1600.webp')`, [tenant, p]);
    const d = String((await one(`insert into public.deals(tenant_id, customer_id, property_id, is_sample) values ($1, $2, $3, true) returning id`, [tenant, c, p])).id);
    await q(`insert into public.commissions(tenant_id, deal_id, is_sample) values ($1, $2, true)`, [tenant, d]);
    const r = String((await one(`insert into public.rentals(tenant_id, property_id, deal_id, is_sample) values ($1, $2, $3, true) returning id`, [tenant, p, d])).id);
    await q(`insert into public.rent_charges(tenant_id, rental_id) values ($1, $2)`, [tenant, r]);
    for (const t of ["customer_demands", "tasks", "appointments", "calls"]) {
      await q(`insert into public.${t}(tenant_id, customer_id, is_sample) values ($1, $2, true)`, [tenant, c]);
    }
    await q(`insert into public.offers(tenant_id, property_id, is_sample) values ($1, $2, true)`, [tenant, p]);
    await q(`insert into public.contracts(tenant_id, customer_id, is_sample) values ($1, $2, true)`, [tenant, c]);
    await q(`insert into public.expenses(tenant_id, title, is_sample) values ($1, 'Ofis kirası', true)`, [tenant]);
    await q(`insert into public.notifications(tenant_id, user_id, is_sample) values ($1, $2, true)`, [tenant, P1]);
    await q(`insert into public.property_control_state(tenant_id, property_id, is_sample) values ($1, $2, true)`, [tenant, p]);
    await q(`insert into public.campaigns(tenant_id, title, is_sample) values ($1, 'Kadıköy duyurusu', true)`, [tenant]);
    await q(`insert into public.communications(tenant_id, customer_id, body, is_sample) values ($1, $2, 'Merhaba', true)`, [tenant, c]);
    await q(`insert into public.fsbo_leads(tenant_id, is_sample) values ($1, true)`, [tenant]);
    await q(`insert into public.finance_accounts(tenant_id, is_sample) values ($1, true)`, [tenant]);
    await q(`insert into public.buildings(tenant_id, notes) values ($1, '[Örnek veri] Site')`, [tenant]);
    await q(`insert into public.league_challenges(tenant_id, description) values ($1, '[Örnek veri] Meydan okuma')`, [tenant]);
    // Kayıt modülleri: bütçe, evrak talebi + yalnız-kayıt dosyası, başvuru bağlantısı + başvuru (kiraya bağlı), tutanak.
    await q(`insert into public.finance_budgets(tenant_id, category, is_sample) values ($1, 'reklam', true)`, [tenant]);
    const dr = String((await one(`insert into public.document_requests(tenant_id, customer_id, property_id, is_sample) values ($1, $2, $3, true) returning id`, [tenant, c, p])).id);
    await q(`insert into public.document_request_files(tenant_id, request_id, storage_path, is_sample) values ($1, $2, 'kayit-bilgisi:title_deed/tapu.jpg', true)`, [tenant, dr]);
    const link = String((await one(`insert into public.rental_application_links(tenant_id, property_id, is_sample) values ($1, $2, true) returning id`, [tenant, p])).id);
    await q(`insert into public.rental_applications(tenant_id, link_id, property_id, customer_id, rental_id, is_sample) values ($1, $2, $3, $4, $5, true)`, [tenant, link, p, c, r]);
    await q(`insert into public.rental_inspections(tenant_id, rental_id, kind, is_sample) values ($1, $2, 'move_in', true)`, [tenant, r]);
  }

  it("boş ofiste örnek veri serbest; gerçek kayıt girildikten sonra örnek müşteri/portföy eklenemez", async () => {
    await seedSample(T);
    expect((await one(`select public.sample_seed_guard($1) g`, [T])).g).toMatchObject({ allowed: true, real_records: 0 });
    await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Gerçek Müşteri')`, [T]);
    await expect(q(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Örnek', true)`, [T])).rejects.toThrow(/SAMPLE_SEED_LOCKED:real_records/);
    await expect(q(`insert into public.properties(tenant_id, title, is_sample) values ($1, 'Örnek', true)`, [T])).rejects.toThrow(/SAMPLE_SEED_LOCKED:real_records/);
    // Süper admin izni gerçek kaydı olan ofiste İŞE YARAMAZ.
    await q(`update public.tenants set sample_seed_override_until = now() + interval '10 minutes' where id = $1`, [T]);
    await expect(q(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Örnek', true)`, [T])).rejects.toThrow(/real_records/);
    expect((await one(`select public.sample_seed_guard($1) g`, [T])).g).toMatchObject({ allowed: false, code: "real_records" });
    // Gerçek kayıt eklemek her zaman serbest.
    await q(`insert into public.customers(tenant_id, full_name) values ($1, 'İkinci gerçek')`, [T]);
  });

  it("purge v2 tüm örnek varlıkları siler, gerçek kayıtlara ve statik dosya yoluna dokunmaz, ofisi kilitler", async () => {
    await seedSample(T);
    const realC = String((await one(`insert into public.customers(tenant_id, full_name) values ($1, 'Gerçek Müşteri') returning id`, [T])).id);
    const realP = String((await one(`insert into public.properties(tenant_id, title) values ($1, 'Gerçek ilan') returning id`, [T])).id);
    await q(`insert into public.property_media(tenant_id, property_id, storage_path) values ($1, $2, $3)`, [T, realP, `${T}/${realP}/x.webp`]);
    await q(`insert into public.communications(tenant_id, customer_id, body) values ($1, $2, 'Gerçek mesaj')`, [T, realC]);
    await q(`insert into public.tasks(tenant_id, title, customer_id, assigned_to) values ($1, 'Gerçek görev', $2, $3)`, [T, realC, P2]);
    // Gerçek kayıt modülü satırları (gerçek müşteri/portföye bağlı) purge'den sağ çıkmalı.
    await q(`insert into public.finance_budgets(tenant_id, category) values ($1, 'ofis')`, [T]);
    const realDr = String((await one(`insert into public.document_requests(tenant_id, customer_id, property_id) values ($1, $2, $3) returning id`, [T, realC, realP])).id);
    await q(`insert into public.document_request_files(tenant_id, request_id, storage_path) values ($1, $2, $3)`, [T, realDr, `${T}/${realDr}/kimlik.jpg`]);
    const realLink = String((await one(`insert into public.rental_application_links(tenant_id, property_id) values ($1, $2) returning id`, [T, realP])).id);
    await q(`insert into public.rental_applications(tenant_id, link_id, property_id) values ($1, $2, $3)`, [T, realLink, realP]);
    // Başka ofisin örnek verisi korunmalı
    const OTHER = String((await one(`insert into public.tenants(slug, name) values ('baska', 'Başka') returning id`)).id);
    await q(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Başka örnek', true)`, [OTHER]);

    await asUser(OWNER);
    const r = (await one(`select public.purge_tenant_sample_data($1) r`, [T])).r as { deleted: Record<string, number>; personas_removed: string[]; personas_kept: string[] };
    for (const t of SAMPLE_TABLES) expect(await count(t, T, "and is_sample = true"), t).toBe(0);
    expect(await count("buildings", T)).toBe(0);
    expect(await count("league_challenges", T)).toBe(0);
    expect(await count("rent_charges", T)).toBe(0);
    // Gerçek kayıtlar yerinde
    expect(await count("customers", T)).toBe(1);
    expect(await count("properties", T)).toBe(1);
    expect(await count("communications", T)).toBe(1);
    expect(await count("tasks", T)).toBe(1);
    expect(await count("property_media", T)).toBe(1);
    expect(await count("customers", OTHER)).toBe(1);
    for (const t of ["finance_budgets", "document_requests", "document_request_files", "rental_application_links", "rental_applications"]) expect(await count(t, T), t).toBe(1);
    expect((await one(`select storage_path from public.document_request_files where tenant_id = $1`, [T])).storage_path).toBe(`${T}/${realDr}/kimlik.jpg`);
    expect(r.deleted).toMatchObject({ customers: 1, properties: 1, deals: 1, campaigns: 1, communications: 1, fsbo_leads: 1, buildings: 1 });
    expect(r.deleted).toMatchObject({ finance_budgets: 1, document_requests: 1, document_request_files: 1, rental_application_links: 1, rental_applications: 1, rental_inspections: 1 });

    // Demo ekip: P1 bağsız → silindi; P2 gerçek göreve atanmış → pasif kaldı; gerçek kullanıcılar aynen aktif.
    expect(r.personas_removed).toEqual([P1]);
    expect(r.personas_kept).toEqual([P2]);
    expect(await count("profiles", T, `and id = '${P1}'`)).toBe(0);
    expect((await one(`select is_active from public.profiles where id = $1`, [P2])).is_active).toBe(false);
    const real = await q(`select id, is_active from public.profiles where tenant_id = $1 and is_sample = false order by full_name`, [T]);
    expect(real.map((x) => x.is_active)).toEqual([true, true]);

    const t = await one(`select real_use_at, sample_seeded_at, sample_cleared_at from public.tenants where id = $1`, [T]);
    expect(t.real_use_at).not.toBeNull();
    expect(t.sample_seeded_at).toBeNull();
  });

  it("gerçek kullanıma geçtikten sonra yeniden tohum reddedilir; süper admin izni yalnız gerçek kaydı yoksa geçer", async () => {
    await seedSample(T);
    await asService();
    await q(`select public.purge_tenant_sample_data($1)`, [T]);
    expect((await one(`select public.sample_seed_guard($1) g`, [T])).g).toMatchObject({ allowed: false, code: "real_use" });
    await expect(q(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Yeniden', true)`, [T])).rejects.toThrow(/SAMPLE_SEED_LOCKED:real_use/);
    // Süper admin kısa süreli izin: gerçek kayıt yok → geçer
    await q(`update public.tenants set sample_seed_override_until = now() + interval '10 minutes' where id = $1`, [T]);
    await q(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Yeniden', true)`, [T]);
    // İzin süresi geçmiş → yine kilit
    await q(`update public.tenants set sample_seed_override_until = now() - interval '1 minute' where id = $1`, [T]);
    await expect(q(`insert into public.properties(tenant_id, title, is_sample) values ($1, 'X', true)`, [T])).rejects.toThrow(/real_use/);
  });

  it("yetki: danışman ve başka ofis sahibi purge edemez; genel demo ofisi purge edilemez ama kilit dışıdır", async () => {
    await seedSample(T);
    await asUser(ADVISOR);
    await expect(q(`select public.purge_tenant_sample_data($1)`, [T])).rejects.toThrow(/ofis sahibi veya genel mudur/);
    await asUser(P2); // demo ekip üyesi (team_lead, is_sample) da yetkisiz
    await expect(q(`select public.purge_tenant_sample_data($1)`, [T])).rejects.toThrow(/ofis sahibi/);
    await asService();
    const DEMO = String((await one(`insert into public.tenants(slug, name, real_use_at) values ('demo-ofis', 'Demo Emlak Ofisi', now()) returning id`)).id);
    await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Vitrin müşterisi')`, [DEMO]);
    await q(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Demo örnek', true)`, [DEMO]);
    await expect(q(`select public.purge_tenant_sample_data($1)`, [DEMO])).rejects.toThrow(/Genel demo ofisi/);
    expect(await count("customers", DEMO)).toBe(2);
  });
});
