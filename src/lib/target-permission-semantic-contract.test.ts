import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

// OA4: hedef aksiyonları kendi dosyasında (eskiden targets-openhouse-sources.ts'in ilk bölümüydü).
const targetSection = read("src/app/actions/targets.ts");

describe("target permission semantic contract", () => {
  it("keeps the page and every target action on the targets capability", () => {
    const pageSource = read("src/app/app/hedefler/page.tsx");

    expect(pageSource).toContain('requireModulePage("targets"');
    expect(targetSection).toContain('requirePermission("targets", "view")');
    // Oluşturma: tekil hedef, toplu kişi hedefi ve "geçen dönemden kopyala" — üçü de targets:create.
    expect(targetSection.match(/requirePermission\("targets", "create"\)/g)).toHaveLength(3);
    expect(targetSection).toContain('requirePermission("targets", "edit")');
    expect(targetSection).toContain('requirePermission("targets", "delete")');
    expect(targetSection).not.toContain('requirePermission("reports"');
    // Hedef aksiyonu açık ev dosyasında kalmaz.
    expect(read("src/app/actions/targets-openhouse-sources.ts")).not.toMatch(/from\("targets"\)/);
  });

  it("tenant-validates every caller-selected target owner before mutation", () => {
    // Kişi: ortak kiracı denetimi; takım/şube: kiracı süzgeçli okuma; toplu: kiracı + aktif profil süzgeci.
    expect(targetSection).toMatch(/validateTenantReferences\(tenantId, \{ profileId: scope\.profileId \}\)/);
    expect(targetSection.match(/await validateScope\(supabase, gate\.tenantId, scope\)/g)).toHaveLength(2);
    expect(targetSection).toContain('.from("teams").select("id").eq("id", scope.teamId).eq("tenant_id", tenantId)');
    expect(targetSection).toContain('.from("branches").select("id").eq("id", scope.branchId).eq("tenant_id", tenantId)');
    expect(targetSection).toContain('.from("profiles").select("id").eq("tenant_id", gate.tenantId).eq("is_active", true)');
  });
});
