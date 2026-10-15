import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { POSTING_EVENT_TYPES, POSTING_RULES, isMemoEvent, isPostingEventType, postingRule } from "./rules";
import {
  commissionCollectionKey, commissionKey, depositKey, dueSettleKey, expenseKey, isPostingKey, legKeyOf, payoutPersonalKey,
  reversalKeyOf, revisedKey, splitKey,
} from "./keys";
import { financePost, financeReverse, parsePostResult, parseReverseResult, toEventPayload } from "./client";
import { cashCategoryLabel } from "../cash/categories";

const ID = "0b7c2f2e-6a51-4c55-9a0e-1f6a3d2b8c11";
const CORE_SQL = readFileSync(resolve(process.cwd(), "supabase/migrations/20261017010000_finance_posting_core.sql"), "utf8") + readFileSync("supabase/migrations/20261017010200_finance_accrual_triggers.sql", "utf8");

describe("kayıt kuralları (rules.ts)", () => {
  it("her olay türünün tek kuralı var; kural şekli tutarlı (mod none ⇔ yön yok)", () => {
    expect(POSTING_RULES.map((r) => r.eventType)).toEqual([...POSTING_EVENT_TYPES]);
    for (const r of POSTING_RULES) {
      expect(r.itemMode === "none").toBe(r.itemDirection === null);
      expect(r.cashMode === "none").toBe(r.cashDirection === null);
      expect(r.keyPrefix).toMatch(/^[a-z_]+$/);
    }
  });

  it("tasarım değişmezleri: tetikleyici tahakkuku nakitsiz, nakit olayı ofis K/Z'sini kişisel hesaba taşımaz", () => {
    expect(postingRule("commission.accrued")).toMatchObject({ itemMode: "required", cashMode: "none", pnl: "income", itemCategory: "komisyon" });
    expect(postingRule("commission.collected")).toMatchObject({ itemMode: "none", cashMode: "required", cashDirection: "in", pnl: "none" });
    expect(postingRule("payout.paid")).toMatchObject({ ownerGmOnly: true, cashDirection: "out", itemCategory: "stopaj" });
    expect(postingRule("payout.personal")).toMatchObject({ accountScope: "user", pnl: "excluded" });
    expect(isMemoEvent("rent.accrued")).toBe(true);
    expect(isMemoEvent("transfer")).toBe(false);
    expect(isPostingEventType("commission.accrued")).toBe(true);
    expect(isPostingEventType("commission.deleted")).toBe(false);
  });

  it("SQL tohumu her olay türünü içerir (pglite testi değerleri satır satır eşler)", () => {
    for (const t of POSTING_EVENT_TYPES) expect(CORE_SQL).toContain(`('${t}', `);
  });

  it("sistem kategorileri okunur etiketle gösterilir", () => {
    expect(cashCategoryLabel("danisman_hakedis")).toBe("Danışman hakedişi");
    expect(cashCategoryLabel("komisyon")).toBe("Komisyon");
  });
});

describe("olay anahtarları (keys.ts)", () => {
  it("tasarımdaki biçimler", () => {
    expect(commissionKey(ID)).toBe(`commission:${ID}`);
    expect(commissionCollectionKey(ID, 2)).toBe(`commission:${ID}:col:2`);
    expect(splitKey(ID.toUpperCase())).toBe(`split:${ID}`);
    expect(payoutPersonalKey(ID)).toBe(`payout:${ID}:personal`);
    expect(depositKey(ID, "out", 1)).toBe(`deposit:${ID}:out:1`);
    expect(dueSettleKey(ID, 3)).toBe(`due:${ID}:pay:3`);
    expect(revisedKey(commissionKey(ID), 2)).toBe(`commission:${ID}:r2`);
    expect(reversalKeyOf(commissionKey(ID))).toBe(`commission:${ID}:rev`);
    expect(legKeyOf(expenseKey(ID), 1)).toBe(`expense:${ID}`);
    expect(legKeyOf(expenseKey(ID), 2)).toBe(`expense:${ID}#2`);
  });

  it("geçersiz kimlik/sıra reddedilir", () => {
    expect(() => commissionKey("abc")).toThrow();
    expect(() => commissionCollectionKey(ID, 0)).toThrow();
    expect(() => revisedKey(commissionKey(ID), 1)).toThrow();
  });

  it("isPostingKey SQL kuralıyla aynı: önek, parçalar, ayrılmış ekler", () => {
    expect(isPostingKey(commissionKey(ID), "commission.accrued")).toBe(true);
    expect(isPostingKey(commissionKey(ID), "commission.split_accrued")).toBe(false);
    expect(isPostingKey(`commission:${ID}:rev`)).toBe(false);
    expect(isPostingKey(`expense:${ID}#2`)).toBe(false);
    expect(isPostingKey("commission")).toBe(false);
    expect(isPostingKey(`Commission:${ID}`)).toBe(false);
    expect(isPostingKey(`commission:${"x".repeat(200)}`)).toBe(false);
  });
});

describe("istemci (client.ts)", () => {
  it("olayı RPC jsonb biçimine çevirir, tanımsız alanları göndermez", () => {
    expect(
      toEventPayload({
        eventType: "commission.collected", postingKey: commissionCollectionKey(ID, 1), sourceId: ID,
        entries: [{ accountId: ID, amount: 100, settles: "item" }],
      }),
    ).toEqual({
      event_type: "commission.collected", posting_key: commissionCollectionKey(ID, 1), source_id: ID,
      entries: [{ account_id: ID, amount: 100, settles: "item" }],
    });
  });

  it("sonuç ayrıştırma: posted/duplicate başarı, hata Türkçe mesaj", () => {
    expect(parsePostResult({ outcome: "duplicate", entry_ids: [ID], open_item_id: null, reversed: true })).toMatchObject({
      ok: true, outcome: "duplicate", entryIds: [ID], reversed: true, message: null,
    });
    expect(parsePostResult({ outcome: "period_locked" })).toMatchObject({ ok: false, message: expect.stringContaining("kilitli") });
    expect(parsePostResult({ outcome: "bilinmeyen" }).outcome).toBe("unknown");
    expect(parseReverseResult({ outcome: "mirrored", entry_ids: [ID], reversal_ids: [ID], reversal_date: "2026-09-01" })).toMatchObject({
      ok: true, reversalIds: [ID], reversalDate: "2026-09-01",
    });
    expect(parseReverseResult({ outcome: "has_settlements" })).toMatchObject({ ok: false, message: expect.stringContaining("geri alın") });
  });

  it("geçersiz anahtar RPC'ye gitmez; RPC hatası rpc_error / period_locked olur", async () => {
    const rpc = vi.fn();
    const sb = { rpc } as unknown as SupabaseClient;
    expect((await financePost(sb, { eventType: "commission.accrued", postingKey: `split:${ID}`, item: { amount: 1 } })).outcome).toBe("invalid_key");
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "DONEM_KILITLI" } });
    expect((await financePost(sb, { eventType: "commission.accrued", postingKey: commissionKey(ID), item: { amount: 1 } })).outcome).toBe("period_locked");
    rpc.mockResolvedValueOnce({ data: { outcome: "posted", entry_ids: [], open_item_id: ID }, error: null });
    expect(await financePost(sb, { eventType: "commission.accrued", postingKey: commissionKey(ID), item: { amount: 1 } })).toMatchObject({ ok: true, openItemId: ID });
    expect(rpc).toHaveBeenLastCalledWith("finance_post", { p_event: expect.objectContaining({ event_type: "commission.accrued" }) });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "x" } });
    expect((await financeReverse(sb, { targetId: ID, reason: "hata" })).outcome).toBe("rpc_error");
    expect(rpc).toHaveBeenLastCalledWith("finance_reverse", { p_target: ID, p_reason: "hata", p_date: null });
  });
});
