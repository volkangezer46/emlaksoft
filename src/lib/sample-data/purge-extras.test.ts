import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SAMPLE_MARKER } from "./markers";
import { purgeSampleModuleData } from "./purge-extras";

const migrations = join(process.cwd(), "supabase/migrations");
const sqlOf = (prefix: string) => readFileSync(join(migrations, readdirSync(migrations).find((f) => f.startsWith(prefix))!), "utf8");

type Call = { table: string; op: string; filters: [string, unknown][] };

function recordingDb(errors: Record<string, { code: string; message: string }> = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "", filters: [] };
    calls.push(call);
    const b: Record<string, unknown> = {};
    const chain: unknown = new Proxy(b, {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve({ count: 2, error: errors[table] ?? null });
        }
        return (...args: unknown[]) => {
          if (prop === "update" || prop === "delete") call.op = prop;
          else call.filters.push([prop, args]);
          return chain;
        };
      },
    });
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, calls };
}

describe("purgeSampleModuleData (RPC'nin bilmediği örnek kayıtlar)", () => {
  it("yalnız bu ofisin işaretli satırlarına dokunur: bina notu + meydan okuma açıklaması + örnek kira deal_id", async () => {
    const { db, calls } = recordingDb();
    const rep = await purgeSampleModuleData(db, "t-1");
    expect(rep.failed).toEqual([]);
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      "update:rentals",
      "delete:buildings",
      "delete:league_challenges",
      "delete:advisor_specialties",
      "delete:advisor_regions",
    ]);
    for (const c of calls) {
      expect(c.filters.some(([k, a]) => k === "eq" && JSON.stringify(a) === JSON.stringify(["tenant_id", "t-1"]))).toBe(true);
    }
    const [rentals, buildings, league, specialties, regions] = calls;
    for (const c of [specialties!, regions!]) {
      expect(c.filters.some(([k, a]) => k === "eq" && JSON.stringify(a) === JSON.stringify(["is_sample", true]))).toBe(true);
    }
    expect(rentals!.filters.some(([k, a]) => k === "eq" && JSON.stringify(a) === JSON.stringify(["is_sample", true]))).toBe(true);
    expect(buildings!.filters.some(([k, a]) => k === "like" && JSON.stringify(a) === JSON.stringify(["notes", `${SAMPLE_MARKER}%`]))).toBe(true);
    expect(league!.filters.some(([k, a]) => k === "like" && JSON.stringify(a) === JSON.stringify(["description", `${SAMPLE_MARKER}%`]))).toBe(true);
    expect(rep.deleted).toMatchObject({ buildings: 2, league_challenges: 2 });
  });

  it("tablo yoksa (42P01) hata değil, atlanır; gerçek hata 'failed' olur", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = recordingDb({ buildings: { code: "42P01", message: "does not exist" } });
    expect((await purgeSampleModuleData(missing.db, "t-1")).failed).toEqual([]);
    const broken = recordingDb({ league_challenges: { code: "XX000", message: "boom" } });
    expect((await purgeSampleModuleData(broken.db, "t-1")).failed).toEqual(["league_challenges"]);
  });
});

describe("temizlik kapsamı — kaskat zinciri (SQL sözleşmesi)", () => {
  const pm = sqlOf("20261008001100_");
  const building = sqlOf("20261008001700_");
  const processSql = sqlOf("20261008001500_");
  const analyses = sqlOf("20261008001800_");

  it("kira tahsilat / sözleşme / hakediş / yansıtma tabloları kira silinince kaskatlanır (RPC rentals siler)", () => {
    for (const t of ["rent_payments", "rental_management_agreements", "owner_payouts", "owner_charge_links"]) {
      const block = pm.slice(pm.indexOf(`create table if not exists public.${t}`), pm.indexOf(");", pm.indexOf(`create table if not exists public.${t}`)));
      expect(block, t).toMatch(/references public\.rentals\(id, tenant_id\) on delete cascade/);
    }
  });

  it("tapu süreci adımları anlaşma, ilan analizi portföy silinince kaskatlanır", () => {
    expect(processSql).toMatch(/deal_id\s+uuid\s+not null references public\.deals\(id\) on delete cascade/);
    expect(analyses).toMatch(/property_id\s+uuid\s+not null references public\.properties\(id\) on delete cascade/);
  });

  it("bina tabloları is_sample taşımaz → ön adım (not işareti) şart; daire/tahakkuk/tahsilat bina silinince kaskatlanır", () => {
    expect(building).not.toMatch(/is_sample/);
    for (const t of ["building_units", "building_charge_batches", "building_charges", "building_payments"]) {
      const start = building.indexOf(`create table if not exists public.${t}`);
      const block = building.slice(start, building.indexOf("comment on", start));
      expect(block, t).toMatch(/on delete cascade/);
    }
  });

  it("rentals.deal_id anlaşmaya RESTRICT bağlıdır → ön adım deal_id'yi boşaltmadan RPC anlaşma silemez", () => {
    const scaffold = sqlOf("20260812000000_");
    expect(scaffold).toMatch(/rentals_deal_tenant_fkey[\s\S]*?on delete restrict/);
    const rpc = sqlOf("20261006000600_");
    expect(rpc.indexOf("delete from public.deals")).toBeLessThan(rpc.indexOf("delete from public.rentals where is_sample"));
  });

  it("havuz kayıtları ve olayları örnek portföy silinince kaskatlanır; uzmanlık/bölge is_sample taşır ve ön adım siler", () => {
    const pool = sqlOf("20260816001500_");
    expect(pool).toMatch(/listing_pool_entries_property_tenant_fkey\s+foreign key \(property_id, tenant_id\) references public\.properties \(id, tenant_id\) on delete cascade/);
    expect(pool).toMatch(/entry_id uuid not null references public\.listing_pool_entries\(id\) on delete cascade/);
    const mig = sqlOf("20261010000800_");
    expect(mig).toMatch(/alter table public\.advisor_specialties add column if not exists is_sample boolean not null default false/);
    expect(mig).toMatch(/alter table public\.advisor_regions add column if not exists is_sample boolean not null default false/);
  });

  it("purgeSampleData RPC'den ÖNCE ön adımı çağırır", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/sample-data/purge.ts"), "utf8");
    expect(src.indexOf("purgeSampleModuleData(")).toBeGreaterThan(0);
    expect(src.indexOf("purgeSampleModuleData(")).toBeLessThan(src.indexOf("session.rpc(PURGE_RPC"));
  });
});
