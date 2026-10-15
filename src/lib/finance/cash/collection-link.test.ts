import { describe, expect, it } from "vitest";
import { collectionResultOf, PERIOD_LOCKED_CASH_WARN, summarizeCommissionEntries, type SourceEntryRow } from "./collection-link";
import type { PostResult } from "../posting/client";

/** SAF: kısmi tahsilat özeti (net tahsilat + sıradaki `commission:{id}:col:{n}` sırası) ve kayıt servisi sonucu eşlemesi. */
const C = "c0000000-0000-4000-8000-000000000001";
const row = (over: Partial<SourceEntryRow>): SourceEntryRow => ({
  id: "e", direction: "in", amount: 0, posting_key: null, voided_at: null, reversal_of: null, ...over,
});
const res = (over: Partial<PostResult>): PostResult => ({
  ok: true, outcome: "posted", entryIds: ["e1"], openItemId: null, redated: false, reversed: false, message: null, ...over,
});

describe("komisyon tahsilat özeti", () => {
  it("net tahsilat = iptal edilmemiş giriş − ayna çıkış; eski (anahtarsız) hareket de sayılır", () => {
    const s = summarizeCommissionEntries([
      row({ id: "legacy", amount: 1000 }),
      row({ id: "a", amount: "500.50", posting_key: `commission:${C}:col:1` }),
      row({ id: "b", amount: 200, posting_key: `commission:${C}:col:2`, voided_at: "2026-10-01" }),
      row({ id: "c", amount: 300, posting_key: `commission:${C}:col:3` }),
      row({ id: "m", amount: 300, direction: "out", posting_key: `commission:${C}:col:3:rev`, reversal_of: "c" }),
    ]);
    expect(s).toEqual({ collected: 1500.5, nextSeq: 4 });
  });

  it("hareket yoksa sıra 1; iptal edilmiş anahtar yeniden kullanılmaz", () => {
    expect(summarizeCommissionEntries([])).toEqual({ collected: 0, nextSeq: 1 });
    expect(summarizeCommissionEntries([row({ amount: 10, posting_key: `commission:${C}:col:1`, voided_at: "x" })])).toEqual({ collected: 0, nextSeq: 2 });
  });
});

describe("kayıt servisi sonucu → tahsilat sonucu", () => {
  it("posted/duplicate başarı; kilit, aşım ve diğerleri uyarı", () => {
    expect(collectionResultOf(res({}), 100)).toEqual({ ok: true, entryId: "e1", amount: 100 });
    expect(collectionResultOf(res({ outcome: "duplicate" }), 100)).toEqual({ ok: true, duplicate: true, entryId: "e1" });
    expect(collectionResultOf(res({ ok: false, outcome: "period_locked" }), 1)).toMatchObject({ ok: false, warning: PERIOD_LOCKED_CASH_WARN });
    expect(collectionResultOf(res({ ok: false, outcome: "amount_exceeds_open" }), 1)).toMatchObject({ ok: false, code: "amount_exceeds_source" });
    expect(collectionResultOf(res({ ok: false, outcome: "rpc_error" }), 1)).toMatchObject({ ok: false, code: "rpc_error" });
    expect(collectionResultOf(res({ ok: false, outcome: "forbidden", message: "Bu işlem için yetkiniz yok." }), 1)).toMatchObject({
      ok: false, code: "rejected", warning: expect.stringContaining("yetkiniz yok"),
    });
  });
});
