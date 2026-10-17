import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SEC-6: teklif OKUMA kapsamı (B2) her yüzeyde aynı: ofis geneli olmayan rol (danışman, takım lideri, şube müdürü)
 * yalnız kendi oluşturduğu teklifleri görür. `getOffer` ve karşılaştır zaten uyguluyordu; liste sayfası (liste,
 * sayaçlar, KPI) ve `listOfferRounds` de aynı kurala bağlandı.
 */

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  gate: { ok: true, userId: "u-adv", tenantId: "t1", role: "advisor" } as Record<string, unknown>,
  offer: null as { id: string; created_by: string | null } | null,
  roundsQueried: 0,
}));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => h.gate }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: table === "offers" ? h.offer : null, error: null });
      b.then = (resolve: (v: unknown) => void) => {
        if (table === "offer_rounds") h.roundsQueried += 1;
        resolve({ data: [{ id: "r1", round_no: 1, side: "buyer", amount: 1000, note: null, created_at: "2026-10-01T00:00:00Z" }], error: null });
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));

describe("listOfferRounds kapsamı", () => {
  beforeEach(() => {
    h.roundsQueried = 0;
    h.gate = { ok: true, userId: "u-adv", tenantId: "t1", role: "advisor" };
  });

  it("danışman başkasının teklifinin turlarını göremez (boş liste, tur sorgusu yok)", async () => {
    const { listOfferRounds } = await import("@/app/actions/offers");
    h.offer = { id: "o1", created_by: "u-other" };
    expect(await listOfferRounds("o1")).toEqual([]);
    expect(h.roundsQueried).toBe(0);
    h.offer = null;
    expect(await listOfferRounds("o-yok")).toEqual([]);
  });

  it("danışman kendi teklifinin turlarını görür", async () => {
    const { listOfferRounds } = await import("@/app/actions/offers");
    h.offer = { id: "o1", created_by: "u-adv" };
    expect(await listOfferRounds("o1")).toHaveLength(1);
  });

  it("ofis geneli rol (owner) kapsam denetimi olmadan görür", async () => {
    const { listOfferRounds } = await import("@/app/actions/offers");
    h.gate = { ok: true, userId: "u-own", tenantId: "t1", role: "owner" };
    h.offer = { id: "o1", created_by: "u-other" };
    expect(await listOfferRounds("o1")).toHaveLength(1);
  });

  it("izinsiz kapı boş liste", async () => {
    const { listOfferRounds } = await import("@/app/actions/offers");
    h.gate = { ok: false, error: "yetki" };
    expect(await listOfferRounds("o1")).toEqual([]);
  });
});

describe("teklif listesi sayfası kapsamı (kaynak sözleşmesi)", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/app/teklifler/page.tsx"), "utf8");
  it("ofis geneli olmayan rolde created_by = kullanıcı zorlanır; ?danisman yok sayılır", () => {
    expect(src).toMatch(/const selfOnly = !hasOfficeWideDataScope\(role\)/);
    expect(src).toContain('const danismanF = selfOnly ? "" : uuidParam(params.danisman);');
    expect(src).toContain("selfOnly ? { created_by: userId }");
  });
  it("liste, sayaçlar, açık hacim ve haftalık seri AYNI kapsamı kullanır", () => {
    expect(src).toContain("loadOfferCounts(supabase, scope.created_by ?? null)");
    // Her offers sorgusu .match(scope) taşır (liste + yedek sayaç + hacim + seri).
    const offerQueries = src.match(/from\("offers"\)\.select\([^)]*\)[^;]*?/g) ?? [];
    expect(offerQueries.length).toBeGreaterThanOrEqual(4);
    for (const q of src.split('from("offers")').slice(1)) expect(q.slice(0, 200)).toContain(".match(scope)");
  });
});
