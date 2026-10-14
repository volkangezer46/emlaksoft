import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupMovesByAccount, loadMovesForAccounts, MOVES_CAP, type MoveRow } from "./moves";

function fakeClient(rows: MoveRow[]) {
  const calls: { inIds: unknown; range: [number, number] }[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("cash_entries");
      let inIds: unknown = null;
      const b: Record<string, unknown> = {};
      for (const op of ["select", "is", "gte", "order"]) b[op] = () => b;
      b.in = (_c: string, v: unknown) => ((inIds = v), b);
      b.range = (from: number, to: number) => {
        calls.push({ inIds, range: [from, to] });
        const ids = inIds as string[];
        const sorted = rows.filter((r) => ids.includes(r.account_id)).sort((x, y) => x.account_id.localeCompare(y.account_id));
        return Promise.resolve({ data: sorted.slice(from, to + 1), error: null });
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const row = (account_id: string, i: number, direction = "in"): MoveRow => ({ account_id, direction, amount: String(i), entry_date: "2026-10-01" });

describe("kasa-banka hareketleri: tek sorgu", () => {
  it("hesap sayısından bağımsız TEK istek (account_id in), gruplama JS'te", async () => {
    const accounts = Array.from({ length: 12 }, (_, i) => `acc-${String(i).padStart(2, "0")}`);
    const rows = accounts.flatMap((a, i) => [row(a, i), row(a, i + 1, "out")]);
    const { client, calls } = fakeClient(rows);
    const { moves, error } = await loadMovesForAccounts(client, accounts, "2026-09-14");
    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.inIds).toEqual(accounts);
    expect(moves.get("acc-03")).toEqual([
      { date: "2026-10-01", direction: "in", amount: 3 },
      { date: "2026-10-01", direction: "out", amount: 4 },
    ]);
  });

  it("hareketi olmayan hesap boş seri; tavanı aşan hesap null", () => {
    const rows = Array.from({ length: MOVES_CAP + 1 }, (_, i) => row("a", i));
    const out = groupMovesByAccount(["a", "b"], rows, false);
    expect(out.get("a")).toBeNull();
    expect(out.get("b")).toEqual([]);
  });

  it("toplam tavan kesildiyse son görülen ve sonraki hesaplar null, öncekiler tam", () => {
    const out = groupMovesByAccount(["a", "b", "c"], [row("a", 1), row("b", 2)], true);
    expect(out.get("a")).toEqual([{ date: "2026-10-01", direction: "in", amount: 1 }]);
    expect(out.get("b")).toBeNull();
    expect(out.get("c")).toBeNull();
  });

  it("hesap yoksa istek atılmaz", async () => {
    const { client, calls } = fakeClient([]);
    expect((await loadMovesForAccounts(client, [], "2026-09-14")).moves.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
