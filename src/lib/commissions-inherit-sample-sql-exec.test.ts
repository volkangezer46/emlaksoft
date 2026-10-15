import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016050100_commissions_inherit_sample — komisyonun is_sample'ı anlaşmasından
 * türer (örnek anlaşmanın kazanılmasıyla yazılan komisyon ciroya girmez), başka kiracının anlaşması okunmaz,
 * mevcut uyuşmazlar tek seferlik düzelir, geri alma tetikleyiciyi kaldırır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  stage text not null default 'new', is_sample boolean not null default false);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  deal_id uuid references public.deals(id), gross_amount numeric not null default 0, is_sample boolean not null default false);
`;

describe.skipIf(!mod)("komisyon is_sample anlaşmadan türer (pglite)", () => {
  let db: Db;
  let T1: string, T2: string, SAMPLE: string, REAL: string, FOREIGN_SAMPLE: string, OLD_BAD: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const sampleOf = async (id: string) => (await q(`select is_sample from public.commissions where id = $1`, [id]))[0]!.is_sample;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    SAMPLE = (await q(`insert into public.deals(tenant_id, stage, is_sample) values ($1, 'won', true) returning id`, [T1]))[0]!.id as string;
    REAL = (await q(`insert into public.deals(tenant_id, stage) values ($1, 'won') returning id`, [T1]))[0]!.id as string;
    FOREIGN_SAMPLE = (await q(`insert into public.deals(tenant_id, stage, is_sample) values ($1, 'won', true) returning id`, [T2]))[0]!.id as string;
    // Migration öncesi hatalı kayıt (B085 taban durumu): örnek anlaşmanın komisyonu is_sample=false.
    OLD_BAD = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount) values ($1, $2, 174000) returning id`, [T1, SAMPLE]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261016050100_commissions_inherit_sample.sql"));
  });

  it("mevcut uyuşmaz satır tek seferlik düzelir", async () => {
    expect(await sampleOf(OLD_BAD)).toBe(true);
  });

  it("örnek anlaşmanın kazanılmasıyla yazılan komisyon is_sample=true (gelen değer yok sayılır)", async () => {
    const id = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, is_sample) values ($1, $2, 1, false) returning id`, [T1, SAMPLE]))[0]!.id as string;
    expect(await sampleOf(id)).toBe(true);
  });

  it("gerçek anlaşmanın komisyonu örnek işaretlenemez", async () => {
    const id = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, is_sample) values ($1, $2, 1, true) returning id`, [T1, REAL]))[0]!.id as string;
    expect(await sampleOf(id)).toBe(false);
  });

  it("başka kiracının anlaşması okunmaz; anlaşmasız komisyon gelen değeri korur", async () => {
    const cross = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount) values ($1, $2, 1) returning id`, [T1, FOREIGN_SAMPLE]))[0]!.id as string;
    expect(await sampleOf(cross)).toBe(false);
    const orphan = (await q(`insert into public.commissions(tenant_id, gross_amount, is_sample) values ($1, 1, true) returning id`, [T1]))[0]!.id as string;
    expect(await sampleOf(orphan)).toBe(true);
  });

  it("deal_id değişince yeniden türer", async () => {
    const id = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount) values ($1, $2, 1) returning id`, [T1, REAL]))[0]!.id as string;
    await q(`update public.commissions set deal_id = $2 where id = $1`, [id, SAMPLE]);
    expect(await sampleOf(id)).toBe(true);
  });

  it("idempotent; geri alma tetikleyiciyi kaldırır", async () => {
    await db.exec(read("supabase/migrations/20261016050100_commissions_inherit_sample.sql"));
    await db.exec(read("supabase/rollbacks/20261016050100_commissions_inherit_sample.rollback.sql"));
    const id = (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount) values ($1, $2, 1) returning id`, [T1, SAMPLE]))[0]!.id as string;
    expect(await sampleOf(id)).toBe(false);
  });
});
