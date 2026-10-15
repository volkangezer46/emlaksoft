import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Gerçek unstable_cache semantiğinin küçük modeli: anahtar+tag ile bellek cache;
// fn throw ederse hiçbir şey yazılmaz; revalidateTag tag'li girdileri düşürür.
const store = new Map<string, { value: unknown; tags: string[] }>();
const revalidateTag = vi.fn((tag: string, _profile?: string) => {
  void _profile;
  for (const [k, v] of store) if (v.tags.includes(tag)) store.delete(k);
});
const unstableCache = vi.fn(
  (fn: () => Promise<unknown>, keys: string[], opts: { revalidate: number; tags: string[] }) =>
    async () => {
      const k = keys.join("|");
      const hit = store.get(k);
      if (hit) return hit.value;
      const value = await fn();
      store.set(k, { value, tags: opts.tags });
      return value;
    },
);
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile?: string) => revalidateTag(tag, profile),
  unstable_cache: (...a: Parameters<typeof unstableCache>) => unstableCache(...a),
}));

import {
  REPORT_TTL_SECONDS,
  getTenantReportingAggregates,
  getViewerReportingAggregates,
  invalidateReportsCache,
  reportsCacheTag,
  reportsOfficeCacheKey,
} from "./cache";

type Res = { data: unknown; error: { code?: string; message?: string } | null };
function fakeSupabase(results: Res[]) {
  const rpc = vi.fn(async (_name: string, _args: unknown) => {
    void _name;
    void _args;
    return results.shift() ?? results[0];
  });
  return { rpc, client: { rpc } as never };
}

beforeEach(() => {
  store.clear();
  revalidateTag.mockClear();
  unstableCache.mockClear();
});

describe("reporting cache", () => {
  it("tag adı tenant'a özgüdür", () => {
    expect(reportsCacheTag("t1")).toBe("reports:t1");
    expect(reportsCacheTag("t1")).not.toBe(reportsCacheTag("t2"));
  });

  it("tenantId yoksa cache atlanır ve RPC doğrudan çağrılır", async () => {
    const { rpc, client } = fakeSupabase([{ data: { a: 1 }, error: null }]);
    const res = await getTenantReportingAggregates(client, null, 0);
    expect(res.data).toEqual({ a: 1 });
    expect(unstableCache).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("tenant_reporting_aggregates", { p_as_of: new Date(0).toISOString() });
  });

  it("başarılı sonuç tenant anahtarı/tag/TTL ile cache'lenir ve ikinci çağrı RPC'ye gitmez", async () => {
    const { rpc, client } = fakeSupabase([{ data: { a: 1 }, error: null }]);
    await getTenantReportingAggregates(client, "t1", 1);
    await getTenantReportingAggregates(client, "t1", 2);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, keys, opts] = unstableCache.mock.calls[0];
    expect(keys).toContain("t1");
    expect(opts).toEqual({ revalidate: REPORT_TTL_SECONDS, tags: ["reports:t1"] });
  });

  it("tenantlar birbirinin cache'ini görmez", async () => {
    const a = fakeSupabase([{ data: { who: "a" }, error: null }]);
    const b = fakeSupabase([{ data: { who: "b" }, error: null }]);
    await getTenantReportingAggregates(a.client, "ta", 0);
    const res = await getTenantReportingAggregates(b.client, "tb", 0);
    expect(res.data).toEqual({ who: "b" });
    expect(b.rpc).toHaveBeenCalledTimes(1);
  });

  it("hata cache'e yazılmaz, hata çağırana döner ve sonraki çağrı yeniden dener", async () => {
    const err = { code: "42501", message: "denied" };
    const { rpc, client } = fakeSupabase([
      { data: null, error: err },
      { data: { ok: true }, error: null },
    ]);
    const first = await getTenantReportingAggregates(client, "t1", 0);
    expect(first.error).toEqual(err);
    expect(store.size).toBe(0);
    const second = await getTenantReportingAggregates(client, "t1", 0);
    expect(second.data).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("boş (null) sonuç cache'e yazılmaz", async () => {
    const { client } = fakeSupabase([{ data: null, error: null }]);
    const res = await getTenantReportingAggregates(client, "t1", 0);
    expect(res.data).toBeNull();
    expect(store.size).toBe(0);
  });

  it("beklenmeyen istisna yutulmaz", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(getTenantReportingAggregates({ rpc } as never, "t1", 0)).rejects.toThrow("network");
    expect(store.size).toBe(0);
  });

  it("invalidateReportsCache yalnız ilgili tenant'ın tag'ini 'max' profiliyle düşürür", async () => {
    const a = fakeSupabase([
      { data: { v: 1 }, error: null },
      { data: { v: 2 }, error: null },
    ]);
    const b = fakeSupabase([{ data: { v: "b" }, error: null }]);
    await getTenantReportingAggregates(a.client, "ta", 0);
    await getTenantReportingAggregates(b.client, "tb", 0);
    invalidateReportsCache("ta");
    expect(revalidateTag).toHaveBeenCalledWith("reports:ta", "max");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    const refreshed = await getTenantReportingAggregates(a.client, "ta", 0);
    expect(refreshed.data).toEqual({ v: 2 });
    await getTenantReportingAggregates(b.client, "tb", 0);
    expect(b.rpc).toHaveBeenCalledTimes(1);
  });

  it("aynı kiracıda iki istemci izleyene göre değişen sonucu paylaşmaz (B158)", async () => {
    // Sahip (earnings_all) ve salt okunur aynı kiracıda: ofis geneli kısım ortak önbellekten gelebilir,
    // komisyon/gider kısmı her istemcinin KENDİ oturumuyla, önbelleksiz çağrılır.
    const owner = fakeSupabase([{ data: { month_commission: 262260 }, error: null }]);
    const ro = fakeSupabase([{ data: { month_commission: 0 }, error: null }]);
    const a = await getViewerReportingAggregates(owner.client, 0);
    const b = await getViewerReportingAggregates(ro.client, 0);
    expect(a.data).toEqual({ month_commission: 262260 });
    expect(b.data).toEqual({ month_commission: 0 });
    expect(owner.rpc).toHaveBeenCalledWith("tenant_reporting_viewer_aggregates", { p_as_of: new Date(0).toISOString() });
    expect(ro.rpc).toHaveBeenCalledTimes(1);
    // Ters sıra: salt okunur önce doldursa da sahip kendi değerini görür (önbellek yok).
    const ro2 = fakeSupabase([{ data: { month_commission: 0 }, error: null }]);
    const owner2 = fakeSupabase([{ data: { month_commission: 262260 }, error: null }]);
    await getViewerReportingAggregates(ro2.client, 1);
    expect((await getViewerReportingAggregates(owner2.client, 1)).data).toEqual({ month_commission: 262260 });
    expect(unstableCache).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("ofis geneli önbellek anahtarı kullanıcıdan bağımsızdır ve eski tek-RPC anahtarıyla çakışmaz", async () => {
    expect(reportsOfficeCacheKey("t1")).toEqual(["reports-aggregates", "office", "t1"]);
    const a = fakeSupabase([{ data: { summary: { customers: 3 } }, error: null }]);
    await getTenantReportingAggregates(a.client, "t1", 0);
    const [, keys] = unstableCache.mock.calls[0];
    expect(keys).toEqual(["reports-aggregates", "office", "t1"]);
  });
});

describe("rapor RPC sözleşmesi (20261016060000)", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261016060000_reporting_aggregates_local_axis.sql"), "utf8");
  const body = (name: string) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf("\n$$;", start);
    return sql.slice(start, end);
  };

  it("ofis geneli RPC kullanıcıya ya da kazanç/gider iznine bağlı veri döndürmez (kiracı önbelleği güvenli)", () => {
    const office = body("tenant_reporting_aggregates");
    expect(office).not.toMatch(/auth\.uid\(\)/);
    expect(office).not.toContain("earnings_all");
    expect(office).not.toContain("'expenses'");
    expect(office).not.toContain("public.commissions");
    expect(office).not.toContain("public.expenses");
  });

  it("izleyen RPC'si kazanç gizliliğini ve gider iznini uygular, ekseni yerel aydan kurar", () => {
    const viewer = body("tenant_reporting_viewer_aggregates");
    expect(viewer).toContain("has_effective_permission('earnings_all', 'view')");
    expect(viewer).toContain("has_effective_permission('expenses', 'view')");
    expect(viewer).toContain("to_char(g.lm, 'YYYY-MM') as ym");
    expect(viewer).toContain("a.lm::date");
    // UTC'de timestamptz + '1 month' (gün kayması) kalıbı yok.
    expect(viewer).not.toMatch(/at time zone 'Europe\/Istanbul' - interval/);
  });
});

