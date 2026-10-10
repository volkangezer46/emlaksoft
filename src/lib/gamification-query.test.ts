import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paged } from "./gamification-query";

type R = { id: string; v: number };

/** Sahte tablo: eq/gt/order/limit zincirini tutar; `id` artan sırada keyset uygular. */
function fakeClient(all: R[], opts?: { failOnCall?: number }) {
  const calls: { gt: string | null; limit: number }[] = [];
  const client = {
    from() {
      return {
        select() {
          let gt: string | null = null;
          const b: Record<string, unknown> = {
            eq: () => b,
            gt: (_c: string, v: string) => ((gt = v), b),
            order: () => b,
            limit: (n: number) => {
              calls.push({ gt, limit: n });
              if (opts?.failOnCall === calls.length) return Promise.resolve({ data: null, error: { message: "boom" } });
              const data = all
                .filter((r) => gt === null || r.id > gt)
                .sort((x, y) => (x.id < y.id ? -1 : 1))
                .slice(0, n);
              return Promise.resolve({ data, error: null });
            },
          };
          return b;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ids = (n: number): R[] => Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(6, "0")}`, v: i }));

describe("paged (keyset)", () => {
  it("tek sayfa: dolu olmayan sayfada biter, OFFSET yok", async () => {
    const { client, calls } = fakeClient(ids(10));
    const out = await paged(client, "t", "id, v", (q) => q.eq("tenant_id", "x"));
    expect(out).toHaveLength(10);
    expect(calls).toEqual([{ gt: null, limit: 1000 }]);
  });

  it("çok sayfa: her sayfa önceki sayfanın son id'sinden sonra başlar, hiçbir satır kaybolmaz/tekrarlanmaz", async () => {
    const all = ids(2500);
    const { client, calls } = fakeClient(all);
    const out = await paged(client, "t", "id, v", (q) => q);
    expect(out.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(calls.map((c) => c.gt)).toEqual([null, all[999]!.id, all[1999]!.id]);
  });

  it("tam sayfa sınırında bir boş sayfa daha okuyup biter", async () => {
    const { client, calls } = fakeClient(ids(1000));
    const out = await paged(client, "t", "id", (q) => q);
    expect(out).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it("hata = boş dizi (lig kısmi veriyle açılır)", async () => {
    const { client } = fakeClient(ids(2500), { failOnCall: 2 });
    expect(await paged(client, "t", "id", (q) => q)).toEqual([]);
  });

  it("id kolonu dönmezse güvenli tarafta boş dizi", async () => {
    const noId = Array.from({ length: 1000 }, (_, i) => ({ id: undefined as unknown as string, v: i }));
    const client = {
      from: () => ({
        select: () => {
          const b: Record<string, unknown> = { order: () => b, gt: () => b, limit: () => Promise.resolve({ data: noId, error: null }) };
          return b;
        },
      }),
    } as unknown as SupabaseClient;
    expect(await paged(client, "t", "v", (q) => q)).toEqual([]);
  });
});
