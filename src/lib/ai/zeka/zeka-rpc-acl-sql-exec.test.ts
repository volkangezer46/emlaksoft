import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): SEC-3 — 20261024010000_zeka_learning + 20261027040000_zeka_rpc_service_role_only.
 *  - zeka_log_query, zeka_query_feedback, zeka_knowledge_vectors_read: anon/authenticated EXECUTE YOK, service_role VAR;
 *  - eski imzalar (oturumdan kimlik okuyan) düşer;
 *  - zeka_log_query kimliği yeniden doğrular: uygulama yüzeyinde ofisin aktif profili / aktif personel, yönetimde aktif
 *    personel, vitrinde askıda olmayan ofis; aksi halde satır yazılmaz;
 *  - oy: oturumlu satıra yalnız soran oy verir, satır başına bir kez.
 * Kimlik/izin yardımcıları yalın taslaktır (gerçek gövdeler başka migration'larda).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const U1 = "10000000-0000-4000-8000-000000000001";
const U2 = "10000000-0000-4000-8000-000000000002";
const STAFF = "20000000-0000-4000-8000-000000000001";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table public.tenants(id uuid primary key, status text not null default 'active');
create table public.profiles(id uuid primary key, tenant_id uuid references public.tenants(id), role text not null default 'advisor', is_active boolean default true);
create table public.platform_staff(id uuid primary key, is_active boolean not null default true);
create function public.current_active_tenant_id() returns uuid language sql stable security definer as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create function public.is_platform_staff() returns boolean language sql stable security definer as $$ select exists (select 1 from public.platform_staff where id = auth.uid() and is_active) $$;
create function public.platform_staff_can(text, text) returns boolean language sql stable security definer as $$ select public.is_platform_staff() $$;
grant usage on schema public, auth to anon, authenticated, service_role;
`;

const FNS = [
  "public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid, uuid)",
  "public.zeka_query_feedback(uuid, integer, uuid)",
  "public.zeka_knowledge_vectors_read()",
];

describe.skipIf(!mod)("SEC-3 Zeka RPC'leri yalnız service_role (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const log = (surface: string, tenant: string | null, user: string | null) =>
    q(`select public.zeka_log_query($1, 'soru', 'data', 'local', 0.5, true, null, $2::uuid, $3::uuid) as id`, [surface, tenant, user]).then((r) => r[0]!.id as string | null);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await q(`insert into public.tenants values ($1, 'active'), ($2, 'active'), ($3, 'suspended')`, [T, T2, TS]);
    await q(`insert into public.profiles(id, tenant_id) values ($1, $3), ($2, $4)`, [U1, U2, T, T2]);
    await q(`insert into public.platform_staff values ($1, true)`, [STAFF]);
    await db.exec(read("supabase/migrations/20261024010000_zeka_learning.sql"));
    await db.exec(read("supabase/migrations/20261027040000_zeka_rpc_service_role_only.sql"));
  });

  it("üç fonksiyonda anon/authenticated EXECUTE yok, service_role var; eski imzalar düştü", async () => {
    for (const fn of FNS) {
      const [r] = await q(
        `select has_function_privilege('anon', $1, 'EXECUTE') a, has_function_privilege('authenticated', $1, 'EXECUTE') u, has_function_privilege('service_role', $1, 'EXECUTE') s`,
        [fn],
      );
      expect(r, fn).toEqual({ a: false, u: false, s: true });
    }
    const old = await q(`select to_regprocedure('public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid)') a, to_regprocedure('public.zeka_query_feedback(uuid, integer)') b`);
    expect(old[0]).toEqual({ a: null, b: null });
  });

  it("anon ve authenticated çağıramaz (izin hatası)", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(q(`select public.zeka_log_query('vitrin', 'x', 'data', 'local', 0.5, true, null, '${T}'::uuid, null)`)).rejects.toThrow(/permission denied/);
      await expect(q(`select public.zeka_knowledge_vectors_read()`)).rejects.toThrow(/permission denied/);
      await expect(q(`select public.zeka_query_feedback('${U1}'::uuid, 1, null)`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("zeka_log_query kimliği doğrular (service_role)", async () => {
    await db.exec("set role service_role");
    expect(await log("app", T, U1)).toBeTruthy(); // kendi ofisi
    expect(await log("app", T2, U1)).toBeNull(); // başka ofis adına
    expect(await log("app", T, null)).toBeNull();
    expect(await log("app", T, STAFF)).toBeTruthy(); // salt okunur destek oturumu
    expect(await log("admin", null, STAFF)).toBeTruthy();
    expect(await log("admin", null, U1)).toBeNull(); // personel değil
    expect(await log("vitrin", T, U1)).toBeTruthy();
    expect(await log("vitrin", TS, null)).toBeNull(); // askıdaki ofis
    expect(await log("public", T, U1)).toBeTruthy();
    await db.exec("reset role");
    const rows = await q(`select surface, tenant_id, user_id from public.zeka_query_log order by created_at, surface`);
    const pub = rows.find((r) => r.surface === "public")!;
    expect(pub).toMatchObject({ tenant_id: null, user_id: null }); // anonim yüzey kimlik yazmaz
    const vit = rows.find((r) => r.surface === "vitrin")!;
    expect(vit).toMatchObject({ tenant_id: T, user_id: null });
  });

  it("oy: oturumlu satıra yalnız soran; satır başına bir kez", async () => {
    await db.exec("set role service_role");
    const id = await log("app", T, U1);
    const anon = await log("public", null, null);
    expect((await q(`select public.zeka_query_feedback($1, 1, $2::uuid) ok`, [id, U2]))[0]!.ok).toBe(false);
    expect((await q(`select public.zeka_query_feedback($1, 1, null) ok`, [id]))[0]!.ok).toBe(false);
    expect((await q(`select public.zeka_query_feedback($1, -1, $2::uuid) ok`, [id, U1]))[0]!.ok).toBe(true);
    expect((await q(`select public.zeka_query_feedback($1, 1, $2::uuid) ok`, [id, U1]))[0]!.ok).toBe(false);
    expect((await q(`select public.zeka_query_feedback($1, 1, null) ok`, [anon]))[0]!.ok).toBe(true);
    await db.exec("reset role");
  });

  it("geri alma eski imzaları ve yetkileri geri getirir", async () => {
    const db2 = new mod!.PGlite();
    await db2.exec(STUB);
    await db2.exec(read("supabase/migrations/20261024010000_zeka_learning.sql"));
    await db2.exec(read("supabase/migrations/20261027040000_zeka_rpc_service_role_only.sql"));
    await db2.exec(read("supabase/rollbacks/20261027040000_zeka_rpc_service_role_only.rollback.sql"));
    const r = (
      await db2.query(
        `select has_function_privilege('anon', 'public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid)', 'EXECUTE') a,
                to_regprocedure('public.zeka_log_query(text, text, text, text, numeric, boolean, text, uuid, uuid)') b`,
      )
    ).rows[0];
    expect(r).toEqual({ a: true, b: null });
  });
});
