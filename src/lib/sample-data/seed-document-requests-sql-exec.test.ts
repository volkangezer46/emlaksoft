import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * Örnek evrak talebi tohumu + demo-ofis gece sıfırlamasında kayıt modülleri — İŞLEVSEL SQL TESTİ (pglite; gerçek PL/pgSQL).
 *  - 20261026010000 seed_sample_document_requests: service_role'un tabloya INSERT yetkisi YOKKEN tohum yazar (demo modu +
 *    demo-ofis); gerçek kullanıma geçmiş / gerçek kaydı olan ofisi ve service_role dışı rolleri reddeder; token özeti
 *    fonksiyonda üretilir (CHECK geçer); idempotent; dosya yalnız kayıt bilgisi; rollback fonksiyonu düşürür.
 *  - 20261026010100: demo_reset_snapshot_tables altı kayıt tablosunu ebeveyn → çocuk sırasıyla içerir; gece ziyaretçinin
 *    evrak/bütçe değişikliğini geri alır, eklediğini siler; rollback eski listeye döner.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** 20261024020000'den yalnız kilit kuralı (tenant_real_record_count + sample_seed_guard) — gerçek gövde. */
function guardSql(): string {
  const src = read("supabase/migrations/20261024020000_demo_mode_lock_purge_v2.sql");
  const from = src.indexOf("create or replace function public.tenant_real_record_count");
  const marker = "grant execute on function public.sample_seed_guard(uuid) to authenticated, service_role;";
  const to = src.indexOf(marker);
  if (from < 0 || to < 0) throw new Error("sample_seed_guard gövdesi bulunamadı");
  return src.slice(from, to + marker.length);
}

const SEED_FILE = "supabase/migrations/20261026010000_seed_sample_document_requests.sql";
const SEED_ROLLBACK = "supabase/rollbacks/20261026010000_seed_sample_document_requests.rollback.sql";

const SEED_STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('t.jwt', true), ''), '{}')::jsonb $$;
grant usage on schema auth to service_role, authenticated, anon;
create function public.current_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.is_platform_staff() returns boolean language sql stable as $$ select false $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text, sample_seeded_at timestamptz,
  real_use_at timestamptz, sample_seed_override_until timestamptz);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), role text not null default 'owner',
  is_active boolean not null default true);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, is_sample boolean not null default false);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, is_sample boolean not null default false,
  deleted_at timestamptz);
`;

describe.skipIf(!mod)("seed_sample_document_requests — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const jwt = (role: string) => db.exec(`select set_config('t.jwt', '{"role":"${role}"}', false), set_config('t.uid', '', false)`);
  const seed = (tenant: string, rows: unknown[]) =>
    one(`select public.seed_sample_document_requests($1, $2::jsonb) r`, [tenant, JSON.stringify(rows)]).then((x) => x.r as { requests: number; files: number; skipped: boolean });

  let T: string; // demo modundaki yeni ofis
  let OWNER: string;
  let C: string;
  let P: string;

  const rowsFor = (customer: string, property: string, creator: string) => [
    {
      customer_id: customer, property_id: property, title: "Tapu ve iskan belgesi — EMS-1001", requested_types: ["title_deed", "other"], max_files: 5,
      status: "completed", expires_at: "2026-06-01T10:00:00Z", completed_at: "2026-05-27T12:00:00Z", last_opened_at: "2026-05-27T12:00:00Z",
      created_by: creator, created_at: "2026-05-25T07:00:00Z", is_sample: false,
      files: [
        { doc_type: "title_deed", file_name: "tapu.jpg", file_size: 1842311, mime_type: "image/jpeg", storage_path: "kayit-bilgisi:title_deed/tapu.jpg", created_at: "2026-05-27T12:00:00Z", verified_at: "2026-05-27T12:01:00Z" },
        { doc_type: "other", file_name: "iskan.pdf", file_size: 412906, mime_type: "application/pdf", storage_path: "kayit-bilgisi:other/iskan.pdf", created_at: "2026-05-27T12:01:00Z", verified_at: "2026-05-27T12:02:00Z" },
      ],
    },
    { customer_id: customer, property_id: null, title: "İskan (yeniden)", requested_types: ["other"], status: "revoked", expires_at: "2026-08-01T10:00:00Z", revoked_at: "2026-07-26T09:00:00Z", created_by: creator, created_at: "2026-07-25T07:00:00Z", files: [] },
    { customer_id: "00000000-0000-0000-0000-000000000001", property_id: property, title: "Kimlik", requested_types: ["identity"], status: "active", expires_at: "2026-10-20T15:00:00Z", created_by: null, created_at: "2026-10-16T07:00:00Z", files: [] },
  ];

  beforeEach(async () => {
    db = new mod!.PGlite();
    await db.exec(SEED_STUB);
    await db.exec(read("supabase/migrations/20260821000300_document_requests.sql"));
    // Canlı yetki durumu (20261012002100): service_role'da document_requests için INSERT YOK, dosyada var.
    await db.exec(`grant select, update on public.document_requests to service_role;
      grant select, insert, update on public.document_request_files to service_role;
      grant usage on schema public to service_role, authenticated, anon;`);
    await db.exec(guardSql());
    await db.exec(read(SEED_FILE));
    T = String((await one(`insert into public.tenants(slug, name, sample_seeded_at) values ('yeni-ofis', 'Yeni Ofis', now()) returning id`)).id);
    OWNER = String((await one(`insert into public.profiles(tenant_id) values ($1) returning id`, [T])).id);
    C = String((await one(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Selin Aksoy', true) returning id`, [T])).id);
    P = String((await one(`insert into public.properties(tenant_id, title, is_sample) values ($1, 'Kadıköy 3+1', true) returning id`, [T])).id);
    await jwt("service_role");
  });

  it("service_role tabloya doğrudan ekleyemez; RPC demo modundaki ofise geçerli satır yazar (token özeti, örnek işareti, sayaç)", async () => {
    await db.exec(`set role service_role`);
    await expect(q(`insert into public.document_requests(tenant_id, title, token_hash, expires_at) values ($1, 'x', repeat('a', 64), now())`, [T]))
      .rejects.toThrow(/permission denied/);
    const r = await seed(T, rowsFor(C, P, OWNER));
    await db.exec(`reset role`);
    expect(r).toEqual({ requests: 3, files: 2, skipped: false });

    const reqs = await q(`select * from public.document_requests where tenant_id = $1 order by created_at`, [T]);
    expect(reqs.map((x) => x.status)).toEqual(["completed", "revoked", "active"]);
    for (const x of reqs) {
      expect(x.is_sample).toBe(true); // demo-ofis dışında satırdaki is_sample:false yok sayılır
      expect(String(x.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(reqs.map((x) => x.token_hash)).size).toBe(3);
    expect(reqs.map((x) => x.file_count)).toEqual([2, 0, 0]);
    expect(reqs[0]).toMatchObject({ customer_id: C, property_id: P, created_by: OWNER, revoked_at: null });
    expect(reqs[1]!.revoked_at).not.toBeNull();
    expect(reqs[1]!.completed_at).toBeNull();
    // Bu ofise ait olmayan müşteri / olmayan oluşturan NULL yazılır (kimlik uydurulmaz).
    expect(reqs[2]).toMatchObject({ customer_id: null, property_id: P, created_by: null });

    const files = await q(`select * from public.document_request_files where tenant_id = $1`, [T]);
    expect(files.length).toBe(2);
    for (const f of files) expect(f).toMatchObject({ request_id: reqs[0]!.id, status: "verified", is_sample: true });

    // İdempotent: ikinci çağrı yazmaz.
    expect(await seed(T, rowsFor(C, P, OWNER))).toEqual({ requests: 0, files: 0, skipped: true });
    expect(Number((await one(`select count(*)::int n from public.document_requests`)).n)).toBe(3);
  });

  it("gerçek kullanıma geçmiş ya da gerçek kaydı olan ofisi reddeder; süper admin izni yalnız gerçek kayıt yokken geçerli", async () => {
    await q(`update public.tenants set real_use_at = now() where id = $1`, [T]);
    await expect(seed(T, rowsFor(C, P, OWNER))).rejects.toThrow(/sample_seed_locked: real_use/);
    await q(`update public.tenants set sample_seed_override_until = now() + interval '1 hour' where id = $1`, [T]);
    expect((await seed(T, rowsFor(C, P, OWNER))).requests).toBe(3);

    const T2 = String((await one(`insert into public.tenants(slug, name) values ('gercek', 'Gerçek') returning id`)).id);
    await q(`insert into public.customers(tenant_id, full_name, is_sample) values ($1, 'Gerçek Müşteri', false)`, [T2]);
    await expect(seed(T2, [])).rejects.toThrow(/sample_seed_locked: real_records/);
    expect(Number((await one(`select count(*)::int n from public.document_requests where tenant_id = $1`, [T2])).n)).toBe(0);
  });

  it("service_role dışı rolleri reddeder (EXECUTE yok + gövdede JWT rolü)", async () => {
    for (const role of ["authenticated", "anon"]) {
      await db.exec(`set role ${role}`);
      await expect(seed(T, rowsFor(C, P, OWNER))).rejects.toThrow(/permission denied for function/);
      await db.exec(`reset role`);
    }
    await jwt("authenticated");
    await expect(seed(T, rowsFor(C, P, OWNER))).rejects.toThrow(/yalniz service_role/);
    expect(Number((await one(`select count(*)::int n from public.document_requests`)).n)).toBe(0);
  });

  it("demo-ofis: kilit dışı, satırdaki is_sample korunur (records-seed sample:false); depo yolu taşıyan dosya reddedilir", async () => {
    const D = String((await one(`insert into public.tenants(slug, name, real_use_at) values ('demo-ofis', 'Demo', now()) returning id`)).id);
    const DO = String((await one(`insert into public.profiles(tenant_id) values ($1) returning id`, [D])).id);
    const DC = String((await one(`insert into public.customers(tenant_id, full_name) values ($1, 'Demo Müşteri') returning id`, [D])).id);
    const DP = String((await one(`insert into public.properties(tenant_id, title) values ($1, 'Demo Portföy') returning id`, [D])).id);
    const bad = rowsFor(DC, DP, DO).slice(0, 1).map((r) => ({ ...r, files: [{ ...r.files[0]!, storage_path: `${D}/x/y.jpg` }] }));
    await expect(seed(D, bad)).rejects.toThrow(/kayit bilgisi/);
    expect(await seed(D, rowsFor(DC, DP, DO))).toMatchObject({ requests: 3, files: 2 });
    expect((await q(`select distinct is_sample from public.document_requests where tenant_id = $1`, [D])).map((x) => x.is_sample)).toEqual([false]);
    expect((await seed(D, rowsFor(DC, DP, DO))).skipped).toBe(true);
  });

  it("rollback fonksiyonu düşürür, satırlara dokunmaz", async () => {
    await seed(T, rowsFor(C, P, OWNER));
    await db.exec(read(SEED_ROLLBACK));
    expect((await one(`select to_regprocedure('public.seed_sample_document_requests(uuid, jsonb)') f`)).f).toBeNull();
    expect(Number((await one(`select count(*)::int n from public.document_requests`)).n)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
const RESET_STUB = `
create role service_role; create role authenticated; create role anon;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text unique, name text);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, created_at timestamptz default now());
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, created_at timestamptz default now());
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid references public.properties(id), created_at timestamptz default now());
create table public.finance_budgets(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, period_month date not null, direction text not null,
  category text not null, amount numeric not null, updated_at timestamptz not null default now(), unique (tenant_id, period_month, direction, category));
create table public.document_requests(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  customer_id uuid references public.customers(id) on delete set null, title text, status text not null default 'active', created_at timestamptz not null default now());
create table public.document_request_files(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  request_id uuid not null references public.document_requests(id) on delete cascade, file_name text, created_at timestamptz not null default now());
create table public.rental_application_links(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  property_id uuid not null references public.properties(id) on delete cascade, status text, created_at timestamptz not null default now());
create table public.rental_applications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  link_id uuid references public.rental_application_links(id) on delete set null, property_id uuid not null references public.properties(id) on delete cascade,
  status text, created_at timestamptz not null default now());
create table public.rental_inspections(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  rental_id uuid not null references public.rentals(id) on delete cascade, status text, created_at timestamptz not null default now());
`;

const NEW_TABLES = ["finance_budgets", "document_requests", "document_request_files", "rental_application_links", "rental_applications", "rental_inspections"];
const BASE = "2026-10-20T00:00:00Z";
const NIGHT = "2026-10-21T03:37:00Z";

describe.skipIf(!mod)("demo-ofis gece sıfırlaması — kayıt modülü tabloları (20261026010100)", () => {
  let db: Db;
  let DEMO: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const tables = async () => (await one(`select public.demo_reset_snapshot_tables() t`)).t as string[];

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(RESET_STUB);
    await db.exec(read("supabase/migrations/20261015041000_demo_tenant_nightly_reset.sql"));
    await db.exec(read("supabase/migrations/20261016150301_demo_reset_notification_reads.sql"));
    await db.exec(read("supabase/migrations/20261024020200_demo_tenant_pristine_reset.sql"));
    await db.exec(read("supabase/migrations/20261026010100_demo_reset_records_tables.sql"));
    DEMO = String((await one(`insert into public.tenants(slug, name) values ('demo-ofis', 'Demo Emlak Ofisi') returning id`)).id);
  });

  it("görüntü listesi altı tabloyu ebeveyn → çocuk sırasıyla içerir", async () => {
    const list = await tables();
    for (const t of NEW_TABLES) expect(list).toContain(t);
    const at = (t: string) => list.indexOf(t);
    expect(at("customers")).toBeLessThan(at("document_requests"));
    expect(at("document_requests")).toBeLessThan(at("document_request_files"));
    expect(at("rental_application_links")).toBeLessThan(at("rental_applications"));
    expect(at("rentals")).toBeLessThan(at("rental_inspections"));
    expect(at("rentals")).toBeLessThan(at("rental_applications"));
  });

  it("gece: ziyaretçinin evrak/başvuru/tutanak/bütçe değişikliği geri alınır, silinen tohum geri gelir, eklenen silinir", async () => {
    const c = String((await one(`insert into public.customers(tenant_id, full_name, created_at) values ($1, 'Selin Aksoy', '2026-09-01') returning id`, [DEMO])).id);
    const p = String((await one(`insert into public.properties(tenant_id, title, created_at) values ($1, 'Kadıköy 3+1', '2026-09-01') returning id`, [DEMO])).id);
    const r = String((await one(`insert into public.rentals(tenant_id, property_id, created_at) values ($1, $2, '2026-09-02') returning id`, [DEMO, p])).id);
    const req = String((await one(`insert into public.document_requests(tenant_id, customer_id, title, status, created_at) values ($1, $2, 'Tapu', 'active', '2026-09-03') returning id`, [DEMO, c])).id);
    await q(`insert into public.document_request_files(tenant_id, request_id, file_name, created_at) values ($1, $2, 'tapu.jpg', '2026-09-04')`, [DEMO, req]);
    const link = String((await one(`insert into public.rental_application_links(tenant_id, property_id, status, created_at) values ($1, $2, 'active', '2026-09-03') returning id`, [DEMO, p])).id);
    await q(`insert into public.rental_applications(tenant_id, link_id, property_id, status, created_at) values ($1, $2, $3, 'new', '2026-09-04')`, [DEMO, link, p]);
    await q(`insert into public.rental_inspections(tenant_id, rental_id, status, created_at) values ($1, $2, 'draft', '2026-09-05')`, [DEMO, r]);
    await q(`insert into public.finance_budgets(tenant_id, period_month, direction, category, amount, updated_at) values ($1, '2026-10-01', 'out', 'Kira', 50000, '2026-09-06')`, [DEMO]);

    const cap = (await one(`select public.demo_tenant_capture_baseline($1, $2::timestamptz) r`, [DEMO, BASE])).r as { captured: Record<string, number> };
    expect(cap.captured).toMatchObject({ finance_budgets: 1, document_requests: 1, document_request_files: 1, rental_application_links: 1, rental_applications: 1, rental_inspections: 1 });

    // Ziyaretçi: talebi iptal eder, dosyayı siler, başvuruyu reddeder, tutanağı siler, bütçeyi değiştirir; yeni talep + bütçe ekler.
    await q(`update public.document_requests set status = 'revoked' where id = $1`, [req]);
    await q(`delete from public.document_request_files where tenant_id = $1`, [DEMO]);
    await q(`update public.rental_applications set status = 'rejected' where tenant_id = $1`, [DEMO]);
    await q(`delete from public.rental_inspections where tenant_id = $1`, [DEMO]);
    await q(`update public.finance_budgets set amount = 1, updated_at = '2026-10-20T10:00:00Z' where tenant_id = $1`, [DEMO]);
    await q(`insert into public.finance_budgets(tenant_id, period_month, direction, category, amount, updated_at) values ($1, '2026-10-01', 'out', 'Reklam', 9, '2026-10-20T11:00:00Z')`, [DEMO]);
    const extra = String((await one(`insert into public.document_requests(tenant_id, customer_id, title, created_at) values ($1, $2, 'Ziyaretçi', '2026-10-20T12:00:00Z') returning id`, [DEMO, c])).id);
    await q(`insert into public.document_request_files(tenant_id, request_id, file_name, created_at) values ($1, $2, 'z.jpg', '2026-10-20T12:01:00Z')`, [DEMO, extra]);

    const res = (await one(`select public.demo_tenant_nightly_reset($1, $2::timestamptz) r`, [DEMO, NIGHT])).r as { deleted: Record<string, unknown>; skipped: Record<string, unknown> };
    expect(res.skipped).toEqual({});
    expect(res.deleted).toMatchObject({ document_requests: 1, document_request_files: 1, finance_budgets: 2 });

    expect(await q(`select id, status from public.document_requests where tenant_id = $1`, [DEMO])).toEqual([{ id: req, status: "active" }]);
    expect((await q(`select file_name from public.document_request_files where tenant_id = $1`, [DEMO])).map((x) => x.file_name)).toEqual(["tapu.jpg"]);
    expect((await one(`select status from public.rental_applications where tenant_id = $1`, [DEMO])).status).toBe("new");
    expect(Number((await one(`select count(*)::int n from public.rental_inspections where tenant_id = $1`, [DEMO])).n)).toBe(1);
    expect((await q(`select category, amount::int from public.finance_budgets where tenant_id = $1`, [DEMO]))).toEqual([{ category: "Kira", amount: 50000 }]);

    // İkinci gece: değişiklik yoksa yazma yok.
    const r2 = (await one(`select public.demo_tenant_nightly_reset($1, $2::timestamptz) r`, [DEMO, "2026-10-22T03:37:00Z"])).r as { deleted: Record<string, unknown> };
    expect(r2.deleted).toEqual({});
  });

  it("rollback eski listeye ve gövdeye döner, bu tabloların görüntü satırlarını siler", async () => {
    await db.exec(read("supabase/rollbacks/20261026010100_demo_reset_records_tables.rollback.sql"));
    const list = await tables();
    for (const t of NEW_TABLES) expect(list).not.toContain(t);
    expect(list).toContain("notifications");
    expect(Number((await one(`select count(*)::int n from public.demo_reset_snapshots where tbl = any($1::text[])`, [NEW_TABLES])).n)).toBe(0);
    const src = String((await one(`select prosrc from pg_proc where proname = 'demo_tenant_nightly_reset'`)).prosrc);
    expect(src).not.toContain("document_request_files");
    expect(src).not.toContain("finance_budgets");
    // Gece işi hâlâ çalışır.
    const r = (await one(`select public.demo_tenant_nightly_reset($1, $2::timestamptz) r`, [DEMO, "2026-10-23T03:37:00Z"])).r as Record<string, unknown>;
    expect(r).toHaveProperty("deleted");
  });
});
