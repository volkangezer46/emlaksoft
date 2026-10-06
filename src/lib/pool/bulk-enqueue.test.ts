import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { enqueueListingPoolBatch, type Db } from "./server";

type Call = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };

/** Zincirli PostgREST taklidi: tablo bazlı sabit yanıtlar, yazılan satırları kaydeder. */
function fakeDb(responses: Record<string, unknown[]>, opts: { poolEnabled?: boolean } = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const result = () => {
      if (table === "tenants") return { data: { listing_pool_enabled: opts.poolEnabled !== false }, error: null };
      if (call.op === "insert" && table === "listing_pool_entries") {
        const rows = call.payload as { property_id: string }[];
        return { data: rows.map((r, i) => ({ id: `e${i}`, property_id: r.property_id })), error: null };
      }
      if (call.op === "insert") return { data: null, error: null };
      return { data: responses[table] ?? [], error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const m of ["eq", "in", "is", "not", "gte", "lte", "order", "limit"]) {
      chain[m] = (col: string, val: unknown) => {
        call.filters.push([m, col, val]);
        return chain;
      };
    }
    chain.select = () => chain;
    chain.insert = (payload: unknown) => {
      call.op = "insert";
      call.payload = payload;
      return chain;
    };
    chain.maybeSingle = async () => result();
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return chain;
  };
  return { db: { from } as unknown as Db, calls };
}

const props = [
  { id: "p1", property_type: "daire", transaction_type: "sale", province_id: null, district_id: null, neighborhood_id: null, list_price: 1000 },
  { id: "p2", property_type: "daire", transaction_type: "sale", province_id: null, district_id: null, neighborhood_id: null, list_price: 2000 },
];

describe("enqueueListingPoolBatch (içe aktarma -> ilan havuzu)", () => {
  it("havuz kapalıysa hiçbir şey yazmaz", async () => {
    const { db, calls } = fakeDb({ properties: props }, { poolEnabled: false });
    const res = await enqueueListingPoolBatch(db, { tenantId: "t1", actorId: "u1", source: "import", propertyIds: ["p1"] });
    expect(res).toEqual({ queued: 0, disabled: true, failed: 0 });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("yalnız danışmansız ve açık kaydı olmayan ilanları tek INSERT'le pending olarak açar (idempotent)", async () => {
    const { db, calls } = fakeDb({
      properties: props,
      listing_pool_entries: [{ property_id: "p2" }],
      profiles: [],
    });
    const res = await enqueueListingPoolBatch(db, { tenantId: "t1", actorId: "u1", source: "import", propertyIds: ["p1", "p2", "p1"] });
    expect(res).toEqual({ queued: 1, disabled: false, failed: 0 });

    const propRead = calls.find((c) => c.table === "properties" && c.op === "select")!;
    expect(propRead.filters).toContainEqual(["is", "assigned_to", null]);
    expect(propRead.filters).toContainEqual(["eq", "tenant_id", "t1"]);

    const inserts = calls.filter((c) => c.table === "listing_pool_entries" && c.op === "insert");
    expect(inserts).toHaveLength(1);
    const rows = inserts[0]!.payload as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: "t1", property_id: "p1", source: "import", status: "pending", created_by: "u1" });
    expect(rows[0]).not.toHaveProperty("assigned_to");
    const events = calls.find((c) => c.table === "listing_pool_events" && c.op === "insert")!;
    expect(events.payload).toEqual([
      expect.objectContaining({ tenant_id: "t1", entry_id: "e0", event: "created", actor_id: "u1" }),
    ]);
  });

  it("boş liste: sorgu atmaz", async () => {
    const { db, calls } = fakeDb({});
    expect(await enqueueListingPoolBatch(db, { tenantId: "t1", actorId: null, source: "import", propertyIds: [] })).toEqual({
      queued: 0,
      disabled: false,
      failed: 0,
    });
    expect(calls).toHaveLength(0);
  });
});

describe("içe aktarma bağlantısı", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/actions/import-data.ts"), "utf8");
  it("yalnız portföy + danışmansız içe aktarmada ve denetim kaydı yazıldıktan SONRA havuza alır", () => {
    expect(src).toContain('target === "properties" && assignee.id === null && createdIds.length > 0');
    expect(src).toContain('source: "import"');
    expect(src.indexOf("enqueueListingPoolBatch(supabase")).toBeGreaterThan(src.indexOf("if (!audit.ok)"));
  });
});
