import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261011001000_commission_split_profile — serbest metin taraf -> profil eşleme,
 * dış taraf unresolved sayılmaz, commission_splits eşzamanlama (konuma göre yerinde), geriye dönük backfill, rollback.
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

describe.skipIf(!mod)("commission split profile (pglite)", () => {
  let db: Db;
  let T: string, ALI: string, AYSE: string, AYSE2: string, DEAL: string, LEGACY: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260816000200_commission_splits.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ALI = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ali Yılmaz') returning id`, [T]))[0]!.id as string;
    AYSE = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ayşe Kaya') returning id`, [T]))[0]!.id as string;
    AYSE2 = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'ayşe kaya') returning id`, [T]))[0]!.id as string;
    DEAL = (await q(`insert into public.deals(tenant_id, assigned_to) values ($1, $2) returning id`, [T, ALI]))[0]!.id as string;
    // MIGRATION ÖNCESİ kayıt: serbest metin (backfill kanıtı).
    LEGACY = (await q(
      `insert into public.commissions(tenant_id, deal_id, gross_amount, splits) values ($1, $2, 10000, $3::jsonb) returning id`,
      [T, DEAL, JSON.stringify([{ label: "Ali Yılmaz", rate: 50, amount: 5000 }, { label: "Ofis", rate: 30, amount: 3000 }, { label: "Eski Ortak", rate: 20, amount: 2000 }])],
    ))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261011001000_commission_split_profile.sql"));
  });

  const splitsOf = async (id: string) => (await q(`select splits from public.commissions where id = $1`, [id]))[0]!.splits as Record<string, unknown>[];

  it("backfill: tam ad eşleşen satır profile_id alır, Ofis office olur, eşleşmeyen unresolved işaretlenir", async () => {
    const s = await splitsOf(LEGACY);
    expect(s[0]).toMatchObject({ profile_id: ALI, kind: "advisor" });
    expect(s[1]).toMatchObject({ kind: "office" });
    expect(s[1]).not.toHaveProperty("profile_id");
    expect(s[2]).toMatchObject({ kind: "other", unresolved: true });
    const rows = await q(`select kind, profile_id, unresolved, position, amount::float8 as a from public.commission_splits where commission_id = $1 order by position`, [LEGACY]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "advisor", profile_id: ALI, unresolved: false, a: 5000 });
    expect(rows[2]).toMatchObject({ kind: "other", unresolved: true });
  });

  it("jenerik 'Danışman' anlaşma sorumlusuna eşlenir; aynı adlı iki profil belirsiz kalır (unresolved)", async () => {
    const c = (await q(
      `insert into public.commissions(tenant_id, deal_id, gross_amount, splits) values ($1, $2, 1000, $3::jsonb) returning id`,
      [T, DEAL, JSON.stringify([{ label: "Danışman", rate: 60 }, { label: "Ayşe Kaya", rate: 40 }])],
    ))[0]!.id as string;
    const s = await splitsOf(c);
    expect(s[0]).toMatchObject({ profile_id: ALI, kind: "advisor", amount: 600 });
    expect(s[1]).toMatchObject({ kind: "other", unresolved: true });
    expect(AYSE).not.toBe(AYSE2);
  });

  it("editörden gelen profile_id ve açık dış taraf aynen korunur; unresolved SAYILMAZ", async () => {
    const c = (await q(
      `insert into public.commissions(tenant_id, deal_id, gross_amount, splits) values ($1, null, 2000, $2::jsonb) returning id`,
      [T, JSON.stringify([{ label: "Ayşe K.", rate: 40, profile_id: AYSE, kind: "advisor" }, { label: "Dış Ofis", rate: 20, kind: "other" }, { label: "Ofis", rate: 40, kind: "office" }])],
    ))[0]!.id as string;
    const s = await splitsOf(c);
    expect(s[0]).toMatchObject({ profile_id: AYSE, kind: "advisor" });
    expect(s[1]).toMatchObject({ kind: "other" });
    expect(s[1]).not.toHaveProperty("unresolved");
    // başka ofisin profili reddedilir (profile_id düşer -> ad eşleşmesine bakılır)
    const T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const foreign = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Yabancı') returning id`, [T2]))[0]!.id as string;
    await db.query(`update public.commissions set splits = $2::jsonb where id = $1`, [c, JSON.stringify([{ label: "Yabancı", rate: 10, profile_id: foreign, kind: "advisor" }])]);
    expect((await splitsOf(c))[0]).toMatchObject({ kind: "other", unresolved: true });
    expect((await splitsOf(c))[0]).not.toHaveProperty("profile_id");
  });

  it("güncellemede commission_splits yerinde eşitlenir; kısalan dizide fazla satırlar silinir", async () => {
    await db.query(`update public.commissions set splits = $2::jsonb where id = $1`, [LEGACY, JSON.stringify([{ label: "Ali Yılmaz", rate: 100 }])]);
    const rows = await q(`select profile_id, share_rate::float8 as r, amount::float8 as a from public.commission_splits where commission_id = $1`, [LEGACY]);
    expect(rows).toEqual([{ profile_id: ALI, r: 100, a: 10000 }]);
  });

  it("rollback tetikleyici ve fonksiyonları düşürür", async () => {
    await db.exec(read("supabase/rollbacks/20261011001000_commission_split_profile.rollback.sql"));
    expect((await q(`select to_regprocedure('public.commission_normalize_splits(uuid,uuid,numeric,jsonb)') as t`))[0]!.t).toBeNull();
    expect(await q(`select 1 from pg_trigger where tgname = 'trg_commissions_splits_sync'`)).toHaveLength(0);
  });
});
