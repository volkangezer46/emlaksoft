import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Webhook kuyruğu doğrudan RPC açığı (PB51): ofis üyesi PostgREST'ten `webhook_enqueue`'yu çağırıp yetkisiz olay
 * üretemez, `webhook_mark_delivery` ile başkasının teslimini işaretleyemez. Kural migration metninde kilitli.
 */
const SQL = readFileSync("supabase/migrations/20261007000600_webhook_enqueue_gate.sql", "utf8");
const ROLLBACK = readFileSync("supabase/rollbacks/20261007000600_webhook_enqueue_gate.rollback.sql", "utf8");

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("webhook kuyruğu izin kapısı (20261007000600)", () => {
  it("enqueue: modül izni (customers/properties/commissions × create/edit) ve olay-varlık tutarlılığı", () => {
    const b = fnBody(SQL, "webhook_enqueue");
    expect(b).toContain("public.has_effective_permission(v_module, v_action)");
    expect(b).toMatch(/when 'customer' then 'customers' when 'property' then 'properties' else 'commissions'/);
    expect(b).toMatch(/like '%\.created' then 'create' else 'edit'/);
    expect(b).toContain("split_part(p_event, '.', 1) <> p_entity_type");
    expect(b).toContain("interval '30 seconds'");
    expect(b).toContain("enqueued_by");
    expect(b).toContain("is_sample = false");
    expect(b).toContain("set search_path = ''");
  });

  it("mark_delivery: yalnız kuyruğa yazan, ilk deneme, 10 dk içinde", () => {
    const b = fnBody(SQL, "webhook_mark_delivery");
    expect(b).toContain("d.enqueued_by = v_uid");
    expect(b).toContain("d.attempts = 0");
    expect(b).toContain("interval '10 minutes'");
  });

  it("anon'a açılmaz; rollback 000320 gövdesine döner ve sütunu düşürür", () => {
    expect(SQL).not.toMatch(/grant execute on function public\.webhook_(enqueue|mark_delivery)[^;]*\banon\b/);
    expect(ROLLBACK).toContain("drop column if exists enqueued_by");
    expect(ROLLBACK).not.toContain("has_effective_permission(v_module");
  });
});
