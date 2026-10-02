import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const NAME = "20260813000300_expense_text_appointment_loose_definitions_system";
const code = (p: string) => readFileSync(p, "utf8").replace(/--[^\n]*/g, "");

describe("serbest tanımlar migration sözleşmesi", () => {
  const up = `supabase/migrations/${NAME}.sql`;
  const down = `supabase/rollbacks/${NAME}.rollback.sql`;

  it("migration ve rollback dosyası var", () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it("kritik ifadeleri içerir ve enum ADD VALUE yok", () => {
    const sql = code(up);
    expect(sql).toContain("column category type text");
    expect(sql).toContain("drop constraint if exists appointments_appointment_type_check");
    expect(sql).toContain("between 1 and 64");
    expect(sql).toContain("add column if not exists is_system boolean not null default false");
    expect(sql).toContain("trg_definitions_guard_is_system");
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).not.toMatch(/add value/i);
    expect(sql).not.toMatch(/(?<![.\w])digest\(/);
  });

  it("rollback guard ve kolonu geri alır", () => {
    const sql = code(down);
    expect(sql).toContain("drop column if exists is_system");
    expect(sql).toContain("drop trigger if exists trg_definitions_guard_is_system");
  });
});
