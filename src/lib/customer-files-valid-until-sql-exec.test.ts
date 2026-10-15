import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/** İŞLEVSEL SQL TESTİ (pglite): 20261016110200 customer_files.valid_until — ek, idempotent, rollback temiz. */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIG = "supabase/migrations/20261016110200_customer_files_valid_until.sql";
const RB = "supabase/rollbacks/20261016110200_customer_files_valid_until.rollback.sql";

describe.skipIf(!mod)("customer_files.valid_until (pglite)", () => {
  let db: Db;
  const q = async (sql: string) => (await db.query(sql)).rows;
  const hasColumn = async () =>
    (await q(`select 1 from information_schema.columns where table_name = 'customer_files' and column_name = 'valid_until'`)).length === 1;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(`create table public.customer_files(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      customer_id uuid not null, file_name text not null);
      insert into public.customer_files(tenant_id, customer_id, file_name) values (gen_random_uuid(), gen_random_uuid(), 'eski.pdf');`);
  });

  it("taban yoksa açık hata verir", async () => {
    const other = new mod!.PGlite();
    await expect(other.exec(read(MIG))).rejects.toThrow(/customer_files yok/);
  });

  it("sütun nullable eklenir, mevcut satır süresiz kalır, iki kez uygulanabilir", async () => {
    await db.exec(read(MIG));
    await db.exec(read(MIG));
    expect(await hasColumn()).toBe(true);
    expect((await q(`select valid_until from public.customer_files`))[0]!.valid_until).toBeNull();
    await db.exec(`update public.customer_files set valid_until = '2026-11-01'`);
    expect((await q(`select count(*)::int as n from public.customer_files where valid_until < '2026-12-01'`))[0]!.n).toBe(1);
    expect((await q(`select 1 from pg_indexes where indexname = 'idx_customer_files_valid_until'`)).length).toBe(1);
  });

  it("rollback sütunu ve indeksi kaldırır", async () => {
    await db.exec(read(RB));
    expect(await hasColumn()).toBe(false);
    expect((await q(`select 1 from pg_indexes where indexname = 'idx_customer_files_valid_until'`)).length).toBe(0);
  });
});
