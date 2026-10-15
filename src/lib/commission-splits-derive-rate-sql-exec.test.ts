import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { buildSplits } from "@/lib/commission";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016060300_commission_splits_derive_rate (SK6/B109).
 *  - 'rate' yoksa 'pct' takma adı, o da yoksa tutardan türetilir (round(amount / gross × 100, 4)); 'name' → label.
 *  - 'Ofis' etiketli satır profil kimliği taşısa bile kind 'office' olur.
 *  - Oran ile tutar (satır ve toplam) tutarsızsa 23514; mevcut yazıcıların (buildSplits, kapanış) çıktısı geçer.
 *  - Demo 1be1a3b9 satırı yalnız demo-ofis kiracısında yeniden yazılır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const DEMO_ID = "1be1a3b9-802e-4d5a-b334-5d45e56ecb25";
const STUB = `
create role service_role; create role authenticated; create role anon;
create table public.tenants(id uuid primary key default gen_random_uuid(), slug text);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid, assigned_to uuid);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid, gross_amount numeric not null,
  vat_amount numeric not null default 0, status text not null default 'calculated', splits jsonb not null default '[]'::jsonb);
`;

type Split = Record<string, unknown>;

describe.skipIf(!mod)("commission_normalize_splits oran türetme (pglite)", () => {
  let db: Db;
  let T: string, ADV: string, OWNER: string, DEAL: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const norm = async (gross: number, splits: Split[]) =>
    (await q(`select public.commission_normalize_splits($1::uuid, $2::uuid, $3::numeric, $4::jsonb) as s`, [T, DEAL, gross, JSON.stringify(splits)]))[0]!
      .s as Split[];

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants(slug) values ('demo-ofis') returning id`))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Danışman') returning id`, [T]))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ofis sahibi') returning id`, [T]))[0]!.id as string;
    DEAL = (await q(`insert into public.deals(tenant_id, assigned_to) values ($1, $2) returning id`, [T, ADV]))[0]!.id as string;
    const demo = [
      { pct: 50, kind: "advisor", name: "Danışman", amount: 128000, profile_id: ADV },
      { pct: 50, kind: "advisor", name: "Ofis", amount: 128000, profile_id: OWNER },
    ];
    await q(`insert into public.commissions(id, tenant_id, deal_id, gross_amount, vat_amount, status, splits) values ($1, $2, $3, 256000, 51200, 'paid', $4::jsonb)`, [
      DEMO_ID,
      T,
      DEAL,
      JSON.stringify(demo),
    ]);
    // Canlıdaki BEFORE tetikleyicinin özü: splits yazımında normalize çalışır (20261012001500).
    await db.exec(`
      create function public.t_norm() returns trigger language plpgsql as $$
      begin new.splits := public.commission_normalize_splits(new.tenant_id, new.deal_id, new.gross_amount, new.splits); return new; end $$;
      create trigger t_norm before insert or update of splits on public.commissions for each row execute function public.t_norm();
    `);
    await db.exec(read("supabase/migrations/20261016060300_commission_splits_derive_rate.sql").replace(/set local lock_timeout[^;]*;/g, ""));
  });

  it("demo 1be1a3b9: pct/name → rate/label; 'Ofis' satırı office (profil düşer); tutarlar aynı", async () => {
    const s = (await q(`select splits from public.commissions where id = $1`, [DEMO_ID]))[0]!.splits as Split[];
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ label: "Danışman", rate: 50, amount: 128000, kind: "advisor", profile_id: ADV });
    expect(s[1]).toMatchObject({ label: "Ofis", rate: 50, amount: 128000, kind: "office" });
    expect(s[1]).not.toHaveProperty("profile_id");
    for (const x of s) {
      expect(x).not.toHaveProperty("pct");
      expect(x).not.toHaveProperty("name");
    }
  });

  it("oran yoksa tutardan türetilir (4 hane); tutar yoksa orandan hesaplanır", async () => {
    const s = await norm(300000, [
      { label: "Danışman", amount: 100000 },
      { label: "Ofis", rate: 66.6667 },
    ]);
    expect(Number(s[0]!.rate)).toBe(33.3333);
    expect(s[0]).toMatchObject({ kind: "advisor", profile_id: ADV });
    expect(Number(s[1]!.amount)).toBe(200000.1);
    expect(s[1]!.kind).toBe("office");
  });

  it("oran ve tutar birlikte verilip tutmuyorsa 23514 (share_rate 0 / amount 128.000 deseni)", async () => {
    await expect(norm(256000, [{ label: "Danışman", rate: 0, amount: 128000 }])).rejects.toMatchObject({ code: "23514" });
    await expect(norm(256000, [{ label: "Danışman", rate: 60, amount: 128000 }, { label: "Ofis", rate: 40, amount: 128000 }])).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("mevcut yazıcıların çıktısı geçer: buildSplits (%33/%67 yuvarlama) ve kapanış RPC'si deseni", async () => {
    const net = 123456.78;
    const s = await norm(net, buildSplits(net, 33));
    expect(s.map((x) => Number(x.rate))).toEqual([33, 67]);
    const v = Math.round(net * 0.5 * 100) / 100;
    const s2 = await norm(net, [
      { label: "Danışman", rate: 50, amount: v },
      { label: "Ofis", rate: 50, amount: Math.round((net - v) * 100) / 100 },
    ]);
    expect(s2).toHaveLength(2);
  });

  it("eski kurallar korunur: oran toplamı > %100 ve tutar toplamı > brüt reddedilir", async () => {
    await expect(norm(1000, [{ label: "A", rate: 60 }, { label: "B", rate: 50 }])).rejects.toMatchObject({ code: "23514" });
    await expect(norm(1000, [{ label: "A", amount: 700 }, { label: "B", amount: 400 }])).rejects.toMatchObject({ code: "23514" });
  });

  it("demo düzeltmesi yalnız demo-ofis: başka kiracıdaki aynı biçim yeniden yazılmaz", async () => {
    const other = (await q(`insert into public.tenants(slug) values ('gercek-ofis') returning id`))[0]!.id as string;
    await db.exec(`alter table public.commissions disable trigger t_norm`);
    await q(`update public.commissions set tenant_id = $1, splits = $2::jsonb where id = $3`, [other, JSON.stringify([{ pct: 100, name: "X", amount: 256000 }]), DEMO_ID]);
    await db.exec(`alter table public.commissions enable trigger t_norm`);
    await db.exec(read("supabase/migrations/20261016060300_commission_splits_derive_rate.sql").replace(/set local lock_timeout[^;]*;/g, ""));
    const s = (await q(`select splits from public.commissions where id = $1`, [DEMO_ID]))[0]!.splits as Split[];
    expect(s[0]).toHaveProperty("pct", 100);
  });
});
