import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/clock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clock")>()),
  now: () => Date.UTC(2026, 9, 8, 9, 0, 0),
}));
const { authorityPublishGate } = await import("./ledger");

/**
 * Yayın/aktarım kapısı (authorityPublishGate): iptal/dolmuş yetki engellenir; engeli yalnız ofisin ETKİN SAHİBİNİN
 * yazdığı taze override açar (defterde owner olmayan aktörün satırı açmaz); şema dışı okuma hatasında kapı kapalı kalır.
 */
type Res = { data: unknown; error: unknown };
function chain(result: Res) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
        if (prop === "maybeSingle") return async () => result;
        return () => proxy;
      },
    },
  );
  return proxy;
}

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADV = "22222222-2222-4222-8222-222222222222";
const REVOKED = { authorization_start: "2026-06-01", authorization_end: "2027-06-01", authority_eids_status: "revoked", eids_exempt_reason: null };
const override = (actor: string) => ({ id: "o1", seq: 2, kind: "override", actor_id: actor, created_at: "2026-10-08T08:00:00Z" });

function db(tables: Record<string, Res>): SupabaseClient {
  return { from: (t: string) => chain(tables[t] ?? { data: null, error: null }) } as unknown as SupabaseClient;
}

describe("authorityPublishGate", () => {
  it("iptal edilmiş yetki override yoksa engellenir", async () => {
    const g = await authorityPublishGate(db({ properties: { data: REVOKED, error: null }, eids_authority_events: { data: [], error: null } }), T, "p1");
    expect(g).toMatchObject({ blocked: true, code: "revoked" });
  });

  it("owner olmayan aktörün override satırı engeli AÇMAZ (savunma katmanı)", async () => {
    const g = await authorityPublishGate(
      db({
        properties: { data: REVOKED, error: null },
        eids_authority_events: { data: [override(ADV)], error: null },
        profiles: { data: null, error: null },
      }),
      T,
      "p1",
    );
    expect(g).toMatchObject({ blocked: true, code: "revoked" });
  });

  it("ofis sahibinin taze override'ı engeli uyarıyla açar", async () => {
    const g = await authorityPublishGate(
      db({
        properties: { data: REVOKED, error: null },
        eids_authority_events: { data: [override(OWNER)], error: null },
        profiles: { data: { id: OWNER }, error: null },
      }),
      T,
      "p1",
    );
    expect(g.blocked).toBe(false);
    expect(!g.blocked && g.warning).toMatch(/ofis sahibinin/);
  });

  it("şema dışı okuma hatasında kapı kapalı kalır (fail-closed)", async () => {
    const g = await authorityPublishGate(db({ properties: { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } }), T, "p1");
    expect(g).toMatchObject({ blocked: true, code: "unavailable" });
    expect(!g.blocked ? "" : g.error).toMatch(/^Ne oldu: .*Ne yapmalı:/);
  });
});
