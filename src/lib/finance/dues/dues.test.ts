import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { depositPostingKey, dueCategory, duePostingKey, dueStatusOf, isDueOverdue, mapDueRow } from "./dues";
import { DUE_FN_MESSAGES, dueErrorMessage } from "./errors";
import { cashCategoryLabel, DEPOSIT_CATEGORY } from "@/lib/finance/cash/categories";

const SQL = readFileSync(resolve(process.cwd(), "supabase/migrations/20261017010500_property_dues_open_items.sql"), "utf8");

describe("aidat açık kalemi (WP4) TS aynası", () => {
  it("olay anahtarları SQL ile aynı biçimde", () => {
    expect(duePostingKey("abc")).toBe("due:abc");
    expect(depositPostingKey("r1", "received")).toBe("deposit:r1:received");
    expect(SQL).toContain("'due:' || v_id::text");
    expect(SQL).toContain("'deposit:' || p_rental_id::text || ':' || p_event");
  });

  it("kategori yönden türer (SQL ile aynı)", () => {
    expect(dueCategory("payable")).toBe("aidat");
    expect(dueCategory("receivable")).toBe("aidat_tahsilat");
    expect(SQL).toContain("case when v_dir = 'receivable' then 'aidat_tahsilat' else 'aidat' end");
    expect(cashCategoryLabel(DEPOSIT_CATEGORY)).toBe("Depozito (emanet)");
    expect(SQL).toContain("'category', 'depozito'");
  });

  it("satır eşlemesi: kalan, durum, portföy dizisi, eski aidat kaynağı", () => {
    const v = mapDueRow({
      id: "i1", source_id: "d1", title: "Eylül", amount: "1500.00", paid_amount: "500", issue_date: "2026-09-01", due_date: "2026-09-10",
      status: "partial", note: null, direction: "payable", settled_on: null, property: [{ id: "p", property_code: "K1", title: null }],
    });
    expect(v).toMatchObject({ id: "i1", sourceId: "d1", amount: 1500, paid: 500, remaining: 1000, status: "partial", period: "2026-09-01" });
    expect(v.property?.id).toBe("p");
    expect(mapDueRow({ id: "i2", source_id: null, title: "x", amount: 1, paid_amount: 0, issue_date: "2026-10-01", due_date: null, status: "open", note: null, direction: "receivable" }).sourceId).toBe("i2");
    expect(dueStatusOf("open")).toBe("unpaid");
    expect(dueStatusOf("cancelled")).toBe("cancelled");
  });

  it("gecikme: açık + vadesi bugün ya da önce", () => {
    expect(isDueOverdue({ status: "unpaid", dueDate: "2026-10-15" }, "2026-10-15")).toBe(true);
    expect(isDueOverdue({ status: "partial", dueDate: "2026-10-01" }, "2026-10-15")).toBe(true);
    expect(isDueOverdue({ status: "paid", dueDate: "2026-10-01" }, "2026-10-15")).toBe(false);
    expect(isDueOverdue({ status: "unpaid", dueDate: null }, "2026-10-15")).toBe(false);
  });

  it("FN kodları Türkçe mesaja çevrilir; SQL'in yükselttiği her aidat kodunun karşılığı var", () => {
    expect(dueErrorMessage({ message: "FN:has_cash" }, "x")).toContain("Muhasebe");
    expect(dueErrorMessage({ message: "DONEM_KILITLI" }, "x")).toContain("ay kilidi");
    for (const code of SQL.matchAll(/finance_v2_raise\('([a-z_]+)'\)/g)) {
      expect(dueErrorMessage({ message: `FN:${code[1]}` }, "x"), code[1]).not.toContain("Sayfayı yenileyip");
    }
    expect(Object.keys(DUE_FN_MESSAGES)).toContain("linked_to_owner");
  });
});
