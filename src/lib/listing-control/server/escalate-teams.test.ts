import { describe, expect, it } from "vitest";
import { resolveTeamLeads } from "./escalate";
import type { Db } from "./db";

type Result = { data: unknown; error: { code: string } | null };

/** Zincirleme sorgu kurucusu: her select() sonunda await edilebilir sabit sonuç döner. */
function fakeDb(tables: Record<string, Result>): Db {
  return {
    from(table: string) {
      const res = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "in", "not", "eq"]) chain[m] = () => chain;
      chain.then = (ok: (r: Result) => unknown) => Promise.resolve(res).then(ok);
      return chain;
    },
  } as unknown as Db;
}

describe("resolveTeamLeads", () => {
  it("danışmanı takım lideriyle eşler, lider kendisiyse atlar", async () => {
    const db = fakeDb({
      profiles: { data: [{ id: "a1", team_id: "t1" }, { id: "lead", team_id: "t1" }], error: null },
      teams: { data: [{ id: "t1", lead_user_id: "lead" }], error: null },
    });
    const m = await resolveTeamLeads(db, ["a1", "lead"]);
    expect(m.get("a1")).toBe("lead");
    expect(m.has("lead")).toBe(false);
  });

  it("takım şeması yoksa (hata) boş harita döner", async () => {
    const db = fakeDb({ profiles: { data: null, error: { code: "42703" } } });
    expect((await resolveTeamLeads(db, ["a1"])).size).toBe(0);
  });

  it("boş girdide sorgu atmadan boş döner", async () => {
    expect((await resolveTeamLeads(fakeDb({}), [])).size).toBe(0);
  });
});
