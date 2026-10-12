import { describe, expect, it } from "vitest";
import { MODULES } from "@/lib/modules/registry";
import { MODULE_ROUTE_TABLE } from "@/lib/modules/route-table";

describe("hafif rota tablosu", () => {
  it("registry MODULES[].routes ile birebir aynı", () => {
    const fromRegistry = MODULES.flatMap((m) => m.routes.map((prefix) => `${prefix}=${m.key}`)).sort();
    const fromTable = MODULE_ROUTE_TABLE.map((r) => `${r.prefix}=${r.key}`).sort();
    expect(fromTable).toEqual(fromRegistry);
  });
});
