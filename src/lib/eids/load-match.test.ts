import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findAuthorityMatch } from "./load";

/** Zincirlenebilir sahte PostgREST sorgusu: her yöntem kendini döndürür, await edilince `result` verir. */
function chain(result: { data: unknown; error: unknown }, calls: string[], tag: string) {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
      return (...args: unknown[]) => {
        calls.push(`${tag}.${prop}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return proxy;
      };
    },
  });
  return proxy;
}

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW = {
  id: "p2", property_code: "P-2", title: "Daire", status: "live", transaction_type: "sale",
  eids_property_no: "EIDS-34-4410-0141", authorization_end: null, district_id: null, neighborhood_id: null, owner_customer_id: null,
};

describe("findAuthorityMatch birebir ön süzgeci", () => {
  it("rakam anahtarı RPC'siyle ayraçlı kaydı (EIDS-34-4410-0141) birebir bulur", async () => {
    const calls: string[] = [];
    const db = {
      rpc: (name: string, args: unknown) => {
        calls.push(`rpc ${name} ${JSON.stringify(args)}`);
        return chain({ data: [ROW], error: null }, calls, name);
      },
      from: (t: string) => chain({ data: [], error: null }, calls, t),
    } as unknown as SupabaseClient;
    const r = await findAuthorityMatch(db, T, { propertyNo: "34.4410.0141", dealKind: "sale" });
    expect(calls[0]).toBe(`rpc eids_properties_by_no_key {"p_tenant_id":"${T}","p_key":"3444100141"}`);
    expect(r.ok && r.result.kind).toBe("exact");
    expect(r.ok && r.result.kind === "exact" ? r.result.propertyId : null).toBe("p2");
  });

  it("RPC yoksa (migration bekliyor) eski ön süzgece düşer", async () => {
    const calls: string[] = [];
    const db = {
      rpc: (name: string) => chain({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }, calls, name),
      from: (t: string) => chain({ data: t === "properties" ? [{ ...ROW, eids_property_no: "3444100141" }] : [], error: null }, calls, t),
    } as unknown as SupabaseClient;
    const r = await findAuthorityMatch(db, T, { propertyNo: "3444100141" });
    expect(calls.some((c) => c.startsWith("properties.or("))).toBe(true);
    expect(r.ok && r.result.kind).toBe("exact");
  });
});
