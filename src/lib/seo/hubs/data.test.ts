import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F8: bölge sayfası ilan yükleyicisi DB hatasını "veri sonu" saymaz; hata atılır, böylece `unstable_cache` eksik
 * kümeyi yazmaz ve önceki iyi değer korunur (bölge sayfaları 30 dk yanlış noindex/404 almaz).
 */

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ fail: false, pages: 0, stored: undefined as unknown, stores: 0 }));

// Next önbelleğinin ilgili davranışı: yalnız başarıyla dönen değer saklanır; tazeleme atarsa eski değer sunulur.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>) => async () => {
    try {
      const v = await fn();
      h.stored = v;
      h.stores += 1;
      return v;
    } catch (e) {
      if (h.stored !== undefined) return h.stored;
      throw e;
    }
  },
}));
vi.mock("../store", () => ({
  SEO_CACHE_TAG: "seo",
  getSeoSettings: async () => ({ sitemap: {} }),
  getHubSettings: async () => ({ enabled: true }),
}));
vi.mock("../included-offices", () => ({
  loadIncludedOffices: async () => new Map([["t1", { slug: "ofis", name: "Ofis" }]]),
}));
const row = (i: number) => ({ id: `p${i}`, tenant_id: "t1", title: `İlan ${i}`, transaction_type: "sale", property_type: "Daire", list_price: 1_000_000, updated_at: "2026-10-01", rooms: "3+1", sqm: "120", currency: "TRY", province: { name: "İstanbul" }, district: { name: "Kadıköy" }, neighborhood: null, slug: null });
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "is", "or", "order"]) b[m] = () => b;
      b.range = async (from: number) => {
        h.pages += 1;
        // İlk sayfa tam (1000 satır), ikinci sayfada hata: eski kod burada `break` edip 1000 satırı "tam küme" sanıyordu.
        if (h.fail && from > 0) return { data: null, error: { code: "57014", message: "timeout" } };
        if (from > 0) return { data: [row(1001)], error: null };
        return { data: Array.from({ length: 1000 }, (_, i) => row(i)), error: null };
      };
      return b;
    },
  }),
}));

describe("getHubListings: DB hatası önbelleğe yazılmaz", () => {
  beforeEach(() => {
    h.fail = false;
    h.pages = 0;
    h.stored = undefined;
    h.stores = 0;
  });

  it("ilk okumada hata: atar (eksik küme dönmez)", async () => {
    const { getHubListings } = await import("./data");
    h.fail = true;
    await expect(getHubListings()).rejects.toThrow(/seo_hub_listings_failed/);
    expect(h.stores).toBe(0);
  });

  it("iyi değer varken hata: önceki tam küme korunur", async () => {
    const { getHubListings } = await import("./data");
    const good = (await getHubListings()) as unknown[];
    expect(good.length).toBe(1001);
    h.fail = true;
    const again = (await getHubListings()) as unknown[];
    expect(again.length).toBe(1001);
    expect(h.stores).toBe(1);
  });
});
