import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000700 gider fişi doğrudan yükleme türü. Taban 20260810000940 GERÇEK dosyası
 * sadeleştirilmiş tablo taklitleri üstünde koşar, ardından 000700 ve rollback'i. Gerçek RLS/depolama DENENMEZ.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.has_effective_permission(text, text) returns boolean language sql stable as $$ select false $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, unique (id, tenant_id));
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, unique (id, tenant_id));
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, unique (id, tenant_id));
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, created_by uuid);
create table public.customer_files(id uuid primary key, tenant_id uuid, customer_id uuid, file_name text, file_size bigint, file_type text,
  storage_path text, label text, uploaded_by uuid);
create table public.property_media(id uuid primary key, tenant_id uuid, property_id uuid, kind text, storage_path text, file_name text,
  file_type text, file_size bigint, is_cover boolean, sort_order integer, has_watermark boolean, uploaded_by uuid);
create table public.storage_deletion_outbox (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid, parent_id uuid, bucket text not null,
  object_path text not null, source_table text not null, source_id uuid, reason text not null, status text not null default 'pending',
  attempt_count integer not null default 0, next_attempt_at timestamptz not null default now(), last_attempt_at timestamptz,
  last_error text, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (bucket, object_path));
`;

describe.skipIf(!mod)("gider fişi yükleme türü (pglite)", () => {
  let db: Db;
  let T: string, U: string, E: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const asService = () => db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  const asUser = () => db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false)`);

  async function session(expenseId: string, mime = "application/pdf", ext = "pdf") {
    const id = (await q(`select gen_random_uuid() as id`))[0]!.id as string;
    await q(
      `insert into public.direct_file_uploads (id, tenant_id, kind, expense_id, requested_by, bucket, storage_path, file_name, file_size,
         claimed_mime, canonical_extension, finalize_expires_at, signed_token_expires_at, cleanup_after)
       values ($1::uuid, $2::uuid, 'expense_receipt', $3::uuid, $4::uuid, 'expense-receipts',
         $2::text || '/' || $3::text || '/' || $1::text || '.' || $6::text, 'fis.' || $6::text, 1200,
         $5::text, $6::text, now() + interval '15 minutes', now() + interval '2 hours', now() + interval '3 hours')`,
      [id, T, expenseId, U, mime, ext],
    );
    return id;
  }

  async function finalize(sessionId: string, expenseId: string, mime = "application/pdf") {
    const lease = (await q(`select gen_random_uuid() as id`))[0]!.id as string;
    const claimed = (await q(`select public.claim_direct_file_upload($1, 'expense_receipt', $2, $3, $4, $5) as r`, [sessionId, T, expenseId, U, lease]))[0]!.r as { status: string };
    expect(claimed.status).toBe("finalizing");
    return (await q(`select public.finalize_direct_file_upload($1, 'expense_receipt', $2, $3, $4, $5, $6, 1200) as r`, [sessionId, T, expenseId, U, lease, mime]))[0]!.r as { created: boolean; status: string };
  }

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260810000940_direct_file_upload_sessions.sql"));
    await db.exec(read("supabase/migrations/20261007000700_expense_receipt_uploads.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    U = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    E = (await q(`insert into public.expenses(tenant_id, title, created_by) values ($1, 'Portal paketi', $2) returning id`, [T, U]))[0]!.id as string;
  });

  it("service_role dışında claim/finalize reddedilir", async () => {
    const s = await session(E);
    await asUser();
    await expect(q(`select public.claim_direct_file_upload($1, 'expense_receipt', $2, $3, $4, gen_random_uuid())`, [s, T, E, U])).rejects.toThrow(/Service role/);
    await asService();
    await q(`delete from public.direct_file_uploads where id = $1`, [s]);
  });

  it("izinli olmayan tür ve gider dışı üst kayıt kısıtla reddedilir", async () => {
    await expect(session(E, "image/gif", "gif")).rejects.toThrow();
    await expect(
      q(`insert into public.direct_file_uploads (id, tenant_id, kind, expense_id, customer_id, requested_by, bucket, storage_path, file_name,
           file_size, claimed_mime, canonical_extension, finalize_expires_at, signed_token_expires_at, cleanup_after)
         values (gen_random_uuid(), $1, 'expense_receipt', $2, null, $3, 'customer-files', 'x', 'fis.pdf', 10, 'application/pdf', 'pdf',
           now() + interval '1 minute', now() + interval '2 hours', now() + interval '3 hours')`, [T, E, U]),
    ).rejects.toThrow();
  });

  it("finalize fiş meta kaydını yazar; yeni fiş eskisinin yerine geçer ve eski nesne silme kuyruğuna girer", async () => {
    await asService();
    const s1 = await session(E);
    expect(await finalize(s1, E)).toMatchObject({ created: true, status: "finalized" });
    const first = (await q(`select storage_path from public.expense_receipt_files where expense_id = $1`, [E]))[0]!.storage_path as string;
    // Tekrar (yanıt kaybı) idempotent.
    const lease = (await q(`select gen_random_uuid() as id`))[0]!.id as string;
    expect(((await q(`select public.finalize_direct_file_upload($1, 'expense_receipt', $2, $3, $4, $5, 'application/pdf', 1200) as r`, [s1, T, E, U, lease]))[0]!.r as { created: boolean }).created).toBe(false);

    const s2 = await session(E, "image/png", "png");
    expect(await finalize(s2, E, "image/png")).toMatchObject({ created: true });
    const rows = await q(`select id, file_type from public.expense_receipt_files where expense_id = $1`, [E]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(s2);
    const queued = await q(`select bucket, parent_id from public.storage_deletion_outbox where object_path = $1`, [first]);
    expect(queued[0]).toMatchObject({ bucket: "expense-receipts", parent_id: E });
  });

  it("gider silinince fiş satırı cascade ile düşer ve nesnesi kuyruğa yazılır", async () => {
    const path = (await q(`select storage_path from public.expense_receipt_files where expense_id = $1`, [E]))[0]!.storage_path as string;
    await q(`delete from public.expenses where id = $1`, [E]);
    expect(await q(`select 1 from public.expense_receipt_files where expense_id = $1`, [E])).toHaveLength(0);
    expect(await q(`select 1 from public.storage_deletion_outbox where object_path = $1`, [path])).toHaveLength(1);
  });

  it("rollback taban gövdeleri ve kısıtları geri kurar", async () => {
    await db.exec(read("supabase/rollbacks/20261007000700_expense_receipt_uploads.rollback.sql"));
    expect((await q(`select to_regclass('public.expense_receipt_files') as t`))[0]!.t).toBeNull();
    const cols = await q(`select 1 from information_schema.columns where table_name = 'direct_file_uploads' and column_name = 'expense_id'`);
    expect(cols).toHaveLength(0);
  });
});
