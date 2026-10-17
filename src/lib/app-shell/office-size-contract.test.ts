import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * PERF-1: ofis büyüklüğü kabuk RPC'sinden (usage.active_branches, 20261027030000). Layout RPC'den SONRA seri iki head-count
 * atmaz; getOfficeSize istek-içi RPC sonucunu kullanır, alan yoksa eski sayıma düşer. SQL tarafı: aktif şube sayımı
 * getOfficeSize ile aynı süzgeç (tenant_id + is_active), INVOKER ve diğer alanlar birebir.
 */
const read = (f: string) => readFileSync(f, "utf8");
const MIG = "supabase/migrations/20261027030000_app_shell_office_size.sql";
const PREV = "supabase/migrations/20261012001100_app_shell_platform_staff.sql";
const fnBody = (sql: string) => sql.slice(sql.indexOf("create or replace function public.app_shell_bootstrap()"));

describe("PERF-1 app_shell_bootstrap active_branches", () => {
  it("migration = previous body + only active_branches (INVOKER, same grants)", () => {
    const next = fnBody(read(MIG));
    const prev = fnBody(read(PREV));
    expect(next).toContain("security invoker");
    expect(next).toContain("'active_branches', (select count(*) from public.branches b where b.tenant_id = v_tenant_id and b.is_active)");
    const strip = (s: string) =>
      s
        .replace(/--[^\n]*/g, "")
        .replace(/,\s*'active_branches'[^\n]*/g, "")
        .replace(/comment on function[\s\S]*?';/g, "")
        .replace(/\s+/g, " ")
        .trim();
    expect(strip(next)).toBe(strip(prev));
    expect(next).toContain("revoke all on function public.app_shell_bootstrap() from public, anon;");
    expect(read(MIG)).not.toMatch(/^\s*notify\s+pgrst/im);
    // Geri alma önceki gövdeye döner.
    const rb = fnBody(read("supabase/rollbacks/20261027030000_app_shell_office_size.rollback.sql"));
    expect(rb).not.toContain("active_branches");
    expect(rb.replace(/\s+/g, " ")).toBe(prev.replace(/\s+/g, " "));
  });

  it("layout uses boot.officeSize before falling back to getOfficeSize; getOfficeSize reads the cached RPC first", () => {
    const layout = read("src/app/app/layout.tsx");
    expect(layout).toMatch(/bootUsable && boot\?\.officeSize\s*\? Promise\.resolve\(boot\.officeSize\)\s*: getOfficeSize\(tenantId\)/);
    const ups = read("src/lib/ui-prefs-server.ts");
    expect(ups).toContain("await loadShellBootstrap()");
    expect(ups).toContain("boot.profile.tenantId === tenantId");
    // Aynı süzgeç: profiles/branches tenant_id + is_active.
    expect(ups).toMatch(/from\("branches"\)[^\n]*\.eq\("tenant_id", tenantId\)\.eq\("is_active", true\)/);
  });
});
