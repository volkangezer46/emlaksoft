import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cron modül kapısı (DB-7/BUG-4): getDisabledModulesByTenant yalnız kapalı satırları SAYFALI okur;
 * PostgREST 1000 satır sınırında kesilmez. Hata ya da üst sınır: güvenli varsayılan (atlama yok + log).
 */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/app-shell/bootstrap", () => ({ loadShellBootstrap: async () => null }));

import { getDisabledModulesByTenant, isDisabledFor } from "@/lib/modules/state";

type Row = { tenant_id: string; module_key: string; enabled: boolean };

function fakeClient(rows: Row[], opts: { failAtPage?: number; error?: { code?: string; message: string } } = {}) {
  const calls = { eq: [] as Array<[string, unknown]>, order: [] as string[], ranges: [] as Array<[number, number]> };
  const client = {
    from: (table: string) => {
      expect(table).toBe("tenant_modules");
      let enabledFilter: unknown = undefined;
      let range: [number, number] = [0, Infinity];
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => (calls.eq.push([k, v]), k === "enabled" && (enabledFilter = v), chain),
        order: (k: string) => (calls.order.push(k), chain),
        range: (from: number, to: number) => ((range = [from, to]), calls.ranges.push(range), chain),
        then: <T,>(resolve: (v: { data: Row[] | null; error: { message: string } | null }) => T) => {
          const page = calls.ranges.length - 1;
          if (opts.error && (opts.failAtPage ?? 0) === page) return Promise.resolve(resolve({ data: null, error: opts.error }));
          const matching = rows.filter((r) => enabledFilter === undefined || r.enabled === enabledFilter);
          // PostgREST max_rows: tek yanıt en çok 1000 satır.
          return Promise.resolve(resolve({ data: matching.slice(range[0], Math.min(range[1] + 1, range[0] + 1000)), error: null }));
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDisabledModulesByTenant", () => {
  it("1001+ kapalı satırı sayfalayarak eksiksiz toplar", async () => {
    const rows: Row[] = Array.from({ length: 1205 }, (_, i) => ({
      tenant_id: `t-${String(i).padStart(5, "0")}`,
      module_key: "keys",
      enabled: false,
    }));
    rows.push({ tenant_id: "t-open", module_key: "keys", enabled: true });
    const { client, calls } = fakeClient(rows);

    const map = await getDisabledModulesByTenant(client);

    expect(map.size).toBe(1205);
    expect(isDisabledFor(map, "t-01204", "keys")).toBe(true);
    expect(isDisabledFor(map, "t-open", "keys")).toBe(false);
    expect(calls.eq).toContainEqual(["enabled", false]);
    expect(calls.order.slice(0, 2)).toEqual(["tenant_id", "module_key"]);
    expect(calls.ranges.length).toBe(2);
  });

  it("bağımlı modülleri de kapalı sayar (portals kapalı → leak da)", async () => {
    const { client } = fakeClient([{ tenant_id: "t1", module_key: "portals", enabled: false }]);
    const map = await getDisabledModulesByTenant(client);
    expect(isDisabledFor(map, "t1", "leak")).toBe(true);
  });

  it("okuma hatasında güvenli varsayılan: boş harita + console.error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({ tenant_id: `t${i}`, module_key: "keys", enabled: false }));
    const { client } = fakeClient(rows, { failAtPage: 1, error: { message: "statement timeout" } });
    const map = await getDisabledModulesByTenant(client);
    expect(map.size).toBe(0);
    expect(log).toHaveBeenCalled();
  });

  it("tablo yoksa (migration uygulanmadı) sessizce boş harita döner", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient([], {
      error: { code: "PGRST205", message: "Could not find the table 'public.tenant_modules' in the schema cache" },
    });
    expect((await getDisabledModulesByTenant(client)).size).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });
});
