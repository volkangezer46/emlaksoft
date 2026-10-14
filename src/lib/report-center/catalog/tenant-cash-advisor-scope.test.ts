import { describe, expect, it } from "vitest";
import { testCtx, type Call } from "../test-support";
import type { Filters, Row } from "../types";
import { acikKalemler, gelirGiderDokumu, hesapEkstresi, muhasebeciPaketi } from "./tenant-cash";

/**
 * SN1 (P12): kasa raporlarında başka danışmanın carisine bağlı satır, `earnings_all` yoksa sorguda da süzülür (zamanlanmış
 * teslim servis istemcisiyle çalışır, RLS'e güvenilmez). `earnings_all` sahibinde sorgu değişmez.
 */
const selectOf = (calls: Call[], table: string) => String(calls.find((c) => c.table === table && c.method === "select")?.args[0] ?? "");
const has = (calls: Call[], method: string, first: unknown) => calls.some((c) => c.method === method && c.args[0] === first);

const QUERY_REPORTS = [
  { def: hesapEkstresi, table: "cash_entries", fk: "cash_entries_party_id_fkey" },
  { def: gelirGiderDokumu, table: "cash_entries", fk: "cash_entries_party_id_fkey" },
  { def: acikKalemler, table: "finance_open_items", fk: "finance_open_items_party_id_fkey" },
] as const;

describe("kasa raporları: danışman carisi kapsamı", () => {
  for (const { def, table, fk } of QUERY_REPORTS) {
    it(`${def.id}: earnings_all yoksa gizli cari anti-join'i uygulanır`, async () => {
      const { ctx, calls } = testCtx({ seeAllEarnings: false, officeWide: true });
      if (def.source.kind !== "query") throw new Error("query bekleniyordu");
      await def.source.build(ctx, {} as Filters);
      expect(selectOf(calls, table)).toContain(`gizli_cari:finance_parties!${fk}(id)`);
      expect(has(calls, "eq", "gizli_cari.kind")).toBe(true);
      const or = calls.find((c) => c.method === "or" && (c.args[1] as { referencedTable?: string } | undefined)?.referencedTable === "gizli_cari");
      expect(or?.args[0]).toBe(`user_id.is.null,user_id.neq.${ctx.userId}`);
      expect(calls.some((c) => c.method === "is" && c.args[0] === "gizli_cari" && c.args[1] === null)).toBe(true);
    });

    it(`${def.id}: earnings_all sahibinde sorgu değişmez`, async () => {
      const { ctx, calls } = testCtx({ seeAllEarnings: true, officeWide: true });
      if (def.source.kind !== "query") throw new Error("query bekleniyordu");
      await def.source.build(ctx, {} as Filters);
      expect(selectOf(calls, table)).not.toContain("gizli_cari");
      expect(calls.some((c) => String(c.args[0] ?? "").startsWith("gizli_cari"))).toBe(false);
    });
  }

  it("muhasebeci paketi: defter ve açık kalemlerde gizli danışman carisi satırı düşer", async () => {
    const HIDDEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const OWN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const ledger: Row[] = [
      { origin: "entry", id: "1", account_id: "acc", entry_date: "2026-10-02", kind: "expense", direction: "out", amount: 5000, currency: "TRY", party_id: HIDDEN, title: "Gizli hakediş" },
      { origin: "entry", id: "2", account_id: "acc", entry_date: "2026-10-03", kind: "expense", direction: "out", amount: 3000, currency: "TRY", party_id: OWN, title: "Kendi hakedişi" },
      { origin: "entry", id: "3", account_id: "acc", entry_date: "2026-10-04", kind: "expense", direction: "out", amount: 600, currency: "TRY", party_id: null, title: "Kırtasiye" },
    ];
    const items: Row[] = [
      { id: "i1", direction: "payable", party_id: HIDDEN, title: "Gizli borç", amount: 100, paid_amount: 0, currency: "TRY", due_date: "2026-10-20", status: "open" },
      { id: "i2", direction: "payable", party_id: null, title: "Kira borcu", amount: 200, paid_amount: 0, currency: "TRY", due_date: "2026-10-21", status: "open" },
    ];
    const rows = {
      finance_accounts: [{ id: "acc", name: "Banka", owner_scope: "office" }],
      finance_ledger_v: ledger,
      finance_parties: [{ id: HIDDEN, name: "Danışman Bora" }],
      finance_open_items: items,
    };
    const run = async (seeAll: boolean) => {
      const { ctx } = testCtx({ seeAllEarnings: seeAll, officeWide: true, role: "owner" }, rows);
      if (muhasebeciPaketi.source.kind !== "compute") throw new Error("compute bekleniyordu");
      const out = await muhasebeciPaketi.source.run(ctx, { from: "2026-10-01", to: "2026-10-31" } as Filters);
      return out.filter((r) => r.section === "Defter" || r.section === "Açık kalem").map((r) => String(r.title));
    };
    expect(await run(false)).toEqual(["Kendi hakedişi", "Kırtasiye", "Kira borcu"]);
    expect(await run(true)).toEqual(["Gizli hakediş", "Kendi hakedişi", "Kırtasiye", "Gizli borç", "Kira borcu"]);
  });
});
