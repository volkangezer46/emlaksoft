import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 20260826001900: zincir 000600 -> 000900 (B12) -> 001000 (rol kapisi, B12'yi ezdi) -> 001900 (geri getirme).
 * STATIK sozlesme (DB gerektirmez): md5 korumasi, B12 + rol kapisi birlikte, partner govdesi 001000 ile ayni, rollback = 001000.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r/g, "");
const SQL = read("supabase/migrations/20260826001900_growth_dashboard_b12_reapply.sql");
const R1000 = read("supabase/migrations/20260826001000_growth_dashboard_roles.sql");
const HOTFIX = read("supabase/migrations/20260826000900_growth_hotfix.sql");
const ROLLBACK = read("supabase/rollbacks/20260826001900_growth_dashboard_b12_reapply.rollback.sql");

function body(src: string, fn: string): string {
  const i = src.indexOf(`create or replace function public.${fn}(`);
  expect(i, fn).toBeGreaterThanOrEqual(0);
  const a = src.indexOf("as $$", i) + 5;
  return src.slice(a, src.indexOf("$$;", a));
}
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

describe("growth dashboard B12 geri getirme (001900)", () => {
  it("on-kosul md5: taban = 001000 govdesi, yeni = bu dosyanin govdesi; partner degismez", () => {
    const dash = /\('growth_my_dashboard',\s+'([0-9a-f]{32})',\s+'([0-9a-f]{32})'\)/.exec(SQL);
    expect(dash).not.toBeNull();
    expect(dash![1]).toBe(md5(body(R1000, "growth_my_dashboard")));
    expect(dash![2]).toBe(md5(body(SQL, "growth_my_dashboard")));
    const partner = /\('growth_my_partner_dashboard',\s+'([0-9a-f]{32})',\s+'([0-9a-f]{32})'\)/.exec(SQL);
    expect(partner).not.toBeNull();
    expect(partner![1]).toBe(md5(body(R1000, "growth_my_partner_dashboard")));
    expect(partner![2]).toBe(partner![1]);
    expect(SQL).not.toMatch(/@MD5_/);
    expect(SQL).not.toContain("create or replace function public.growth_my_partner_dashboard(");
  });

  it("B12 (000900) ve rol kapisi (001000) birlikte: money_visible, tam TL yuvarlama, owner/gm disinda NULL", () => {
    const b = body(SQL, "growth_my_dashboard");
    expect(b).toContain("'money_visible', v_money");
    expect(b).toContain("round(coalesce(c.amount_try, 0), 0)");
    expect(b).toContain("coalesce(public.current_profile_role(), '') in ('owner', 'gm')");
    expect(b).toMatch(/if not v_money then\s+return null;/);
    expect(body(HOTFIX, "growth_my_dashboard")).toContain("'money_visible', v_money");
    expect(body(R1000, "growth_my_dashboard")).not.toContain("money_visible");
  });

  it("rollback: 001000 govdesine doner", () => {
    expect(md5(body(ROLLBACK, "growth_my_dashboard"))).toBe(md5(body(R1000, "growth_my_dashboard")));
  });
});
