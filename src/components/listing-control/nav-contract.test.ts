import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_NAV_HREFS, NAV_SECTIONS, moreSections, sidebarModel, visibleSections } from "@/lib/nav-config";
import { NAV_CORE_BY_ROLE } from "@/lib/nav-roles";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "@/lib/permissions";
import { findGate } from "@/lib/billing/page-gates";

const HREF = "/app/ilan-kontrol";
const root = process.cwd();
const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));
const hrefs = (sections: { items: { href: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.href));

describe("İlan Kontrol kayıtları", () => {
  it("menüde Portföy başlığı altında, portals modülüyle, tek kez tanımlıdır (yeni üst başlık yok)", () => {
    expect(NAV_SECTIONS).toHaveLength(9);
    const section = NAV_SECTIONS.find((s) => s.items.some((i) => i.href === HREF));
    expect(section?.id).toBe("portfoy");
    const item = section?.items.find((i) => i.href === HREF);
    expect(item?.module).toBe("portals");
    expect(ALL_NAV_HREFS.filter((h) => h === HREF)).toHaveLength(1);
  });

  it("yönetim kademesinin çekirdek menüsünde görünür; danışman konsolunda Portföy başlığı içinde katlı ulaşılır", () => {
    for (const role of ["owner", "gm", "branch_manager"] as const) {
      expect(NAV_CORE_BY_ROLE[role], role).toContain(HREF);
      expect(canAccessModule(role, "portals"), role).toBe(true);
      expect(hrefs(visibleSections(accessibleOf(role), { mode: "simple", role })), role).toContain(HREF);
    }
    // Danışman/takım lideri çekirdeği 9 satırla sınırlıdır (menü sadeleştirme); İlan Kontrol Portföy başlığında katlıdır, kaybolmaz.
    for (const role of ["team_lead", "advisor"] as const) {
      expect(canAccessModule(role, "portals"), role).toBe(true);
      expect(hrefs(visibleSections(accessibleOf(role), { mode: "simple", role })), role).not.toContain(HREF);
      const m = sidebarModel(accessibleOf(role), { simple: true, role });
      const portfoy = m.groups.find((g) => g.section.id === "portfoy");
      expect(portfoy?.folded.map((i) => i.href), role).toContain(HREF);
    }
  });

  it("portals izni olmayan rol menüde görmez (muhasebe, çağrı merkezi)", () => {
    for (const role of ["accounting", "call_center"] as const) {
      const all = [...hrefs(visibleSections(accessibleOf(role))), ...hrefs(moreSections(accessibleOf(role), { role }))];
      expect(all, role).not.toContain(HREF);
    }
  });

  it("paket kilidi: Ofis ve üstü; plans.ts'e dokunulmadı (yalnız page-gates kaydı)", () => {
    const gate = findGate(`${HREF}/anomaliler`);
    expect(gate?.href).toBe(HREF);
    expect(gate?.minPlan).toBe("office");
  });

  it("izin kapısı: her sayfa requireModulePage('portals', ...) çağırır; sayfa dosyaları vardır", () => {
    for (const p of ["page.tsx", "liste/page.tsx", "anomaliler/page.tsx", "rapor/page.tsx"]) {
      const file = join(root, "src/app/app/ilan-kontrol", p);
      expect(existsSync(file), p).toBe(true);
      expect(readFileSync(file, "utf8"), p).toContain('requireModulePage("portals", "/app/ilan-kontrol")');
    }
  });

  it("ekran kodu service_role, ham Date ve 'lead' kelimesi içermez", () => {
    const dirs = ["src/components/listing-control", "src/app/app/ilan-kontrol"];
    const files = [
      "helpers.ts", "lifecycle-model.ts", "readers.ts", "closure-reader.ts", "ui-parts.tsx", "dashboard-sections.tsx",
      "anomaly-actions.tsx", "portal-bind-form.tsx", "property-lifecycle-panel.tsx", "advisor-ops-card.tsx", "sub-nav.tsx",
    ].map((f) => join(root, dirs[0]!, f));
    for (const page of ["page.tsx", "liste/page.tsx", "anomaliler/page.tsx", "rapor/page.tsx"]) files.push(join(root, dirs[1]!, page));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/createAdminClient/);
      expect(src, f).not.toMatch(/Date\.now\(\)|new Date\(\)/);
      expect(src, f).not.toMatch(/\blead\b/i);
    }
  });
});
