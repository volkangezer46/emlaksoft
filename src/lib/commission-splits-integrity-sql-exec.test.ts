import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012001500_commission_splits_integrity — oran toplamı > 100,01, tutar toplamı > brüt + 0,01,
 * hakedişi olan konumda profil değişimi (42501) reddi; normal yazım geçer; eski kayıtlara backfill yok; rollback.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$ select true $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, unique (id, tenant_id));
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  deal_id uuid references public.deals(id), gross_amount numeric not null, status text default 'calculated',
  splits jsonb not null default '[]', unique (tenant_id, id));
`;

describe.skipIf(!mod)("commission splits integrity (pglite)", () => {
  let db: Db;
  let T: string, ALI: string, AYSE: string, OLD: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const insert = (gross: number, splits: unknown[]) =>
    db.query(`insert into public.commissions(tenant_id, gross_amount, splits) values ($1, $2, $3::jsonb) returning id`, [T, gross, JSON.stringify(splits)]);
  const update = (id: string, splits: unknown[]) =>
    db.query(`update public.commissions set splits = $2::jsonb where id = $1`, [id, JSON.stringify(splits)]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260816000200_commission_splits.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ALI = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ali Yılmaz') returning id`, [T]))[0]!.id as string;
    AYSE = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ayşe Kaya') returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261011001000_commission_split_profile.sql"));
    // Hakediş tablosu bu testte yalın taslaktır (yalnız tetikleyicinin okuduğu sütunlar).
    await db.exec(`create table public.commission_payouts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
      commission_id uuid not null, split_id uuid, profile_id uuid not null, amount numeric, status text not null default 'pending')`);
    // ESKİ (hatalı) kayıt: yeni kural gelmeden önce yazılmış; oran toplamı 130.
    OLD = (await insert(1000, [{ label: "Ali Yılmaz", rate: 80, profile_id: ALI, kind: "advisor" }, { label: "Ofis", rate: 50, kind: "office" }])).rows[0]!.id as string;
    await db.exec(read("supabase/migrations/20261012001500_commission_splits_integrity.sql"));
  });

  it("normal yazım geçer; istemci amount'u yeniden hesaplanmaz", async () => {
    const r = await insert(1000, [{ label: "Ali Yılmaz", rate: 60, amount: 600, profile_id: ALI, kind: "advisor" }, { label: "Ofis", rate: 40, kind: "office" }]);
    const s = (await q(`select splits from public.commissions where id = $1`, [r.rows[0]!.id]))[0]!.splits as Record<string, unknown>[];
    expect(s[0]).toMatchObject({ amount: 600, profile_id: ALI });
    expect(s[1]).toMatchObject({ amount: 400 });
  });

  it("oran toplamı 100,01'i aşarsa reddeder (100,01 geçer)", async () => {
    await expect(insert(1000, [{ label: "Ofis", rate: 60, kind: "office" }, { label: "Dış", rate: 40.02, kind: "other" }])).rejects.toThrow(/oranlarının toplamı/);
    await expect(insert(1000, [{ label: "Ofis", rate: 60, kind: "office" }, { label: "Dış", rate: 40.01, kind: "other" }])).resolves.toBeTruthy();
  });

  it("tutar toplamı brüt + 0,01'i aşarsa reddeder", async () => {
    await expect(insert(1000, [{ label: "Ofis", rate: 50, amount: 800, kind: "office" }, { label: "Dış", rate: 50, amount: 300, kind: "other" }])).rejects.toThrow(/tutarlarının toplamı/);
  });

  it("hakedişi olan konumda profil değişirse 42501; aynı profil veya iptal edilmiş hakedişte geçer", async () => {
    const id = (await insert(1000, [{ label: "Ali Yılmaz", rate: 50, profile_id: ALI, kind: "advisor" }, { label: "Ofis", rate: 50, kind: "office" }])).rows[0]!.id as string;
    const split = (await q(`select id from public.commission_splits where commission_id = $1 and position = 0`, [id]))[0]!.id as string;
    const payout = (await q(`insert into public.commission_payouts(tenant_id, commission_id, split_id, profile_id, amount) values ($1,$2,$3,$4,500) returning id`, [T, id, split, ALI]))[0]!.id as string;
    const swapped = [{ label: "Ayşe Kaya", rate: 50, profile_id: AYSE, kind: "advisor" }, { label: "Ofis", rate: 50, kind: "office" }];
    await expect(update(id, swapped)).rejects.toMatchObject({ code: "42501" });
    // oran değişimi (aynı profil) serbest
    await expect(update(id, [{ label: "Ali Yılmaz", rate: 40, profile_id: ALI, kind: "advisor" }, { label: "Ofis", rate: 60, kind: "office" }])).resolves.toBeTruthy();
    await db.query(`update public.commission_payouts set status = 'cancelled' where id = $1`, [payout]);
    await expect(update(id, swapped)).resolves.toBeTruthy();
  });

  it("eski kayıtlara backfill yapılmaz; eski hatalı kayıt yalnız yeniden yazılırken reddedilir", async () => {
    const s = (await q(`select splits from public.commissions where id = $1`, [OLD]))[0]!.splits as Record<string, unknown>[];
    expect(s.map((x) => x.rate)).toEqual([80, 50]);
    await expect(db.query(`update public.commissions set splits = splits where id = $1`, [OLD])).rejects.toThrow(/oranlarının toplamı/);
  });

  it("rollback eski gövdeyi geri koyar: aşan oran yeniden yazılabilir", async () => {
    await db.exec(read("supabase/rollbacks/20261012001500_commission_splits_integrity.rollback.sql"));
    await expect(insert(1000, [{ label: "Ofis", rate: 90, kind: "office" }, { label: "Dış", rate: 90, kind: "other" }])).resolves.toBeTruthy();
  });
});
