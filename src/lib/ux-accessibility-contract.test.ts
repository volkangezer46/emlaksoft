import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(file, "utf8");
}

const mainContentShells = [
  "src/components/auth/auth-shell.tsx",
  "src/components/legal-page.tsx",
  "src/components/public/token-page.tsx",
  "src/components/public/portal-kit.tsx",
  "src/app/musteri-portali/[token]/page.tsx",
  "src/app/malik-portali/[token]/page.tsx",
] as const;

const directPublicMainPages = [
  "src/app/page.tsx",
  "src/app/danisman/[slug]/page.tsx",
  "src/app/vitrin/[slug]/page.tsx",
  "src/app/vitrin/[slug]/[id]/page.tsx",
  "src/app/vitrin/[slug]/favoriler/page.tsx",
  "src/app/vitrin/[slug]/degerleme/page.tsx",
] as const;

describe("navigation accessibility contract", () => {
  it("keeps one skip-link target in every shared public page shell", () => {
    expect(source("src/app/layout.tsx")).toContain('href="#main-content"');

    for (const file of mainContentShells) {
      expect(source(file).match(/id="main-content"/g), file).toHaveLength(1);
    }
  });

  it("keeps the global skip link valid on direct public page layouts", () => {
    for (const file of directPublicMainPages) {
      expect(source(file).match(/id="main-content"/g), file).toHaveLength(1);
    }
  });

  it("labels application and site navigation landmarks", () => {
    const sidebar = source("src/components/app/app-sidebar.tsx");
    const siteHeader = source("src/components/site-header.tsx");

    // Landmark etiketi NavScroller (ortak <nav>) üzerinden verilir.
    expect(sidebar).toContain('label="Uygulama ana menüsü"');
    expect(source("src/components/ui/console/nav-kit.tsx")).toContain("aria-label={label}");
    expect(siteHeader).toContain('aria-label="Ana site navigasyonu"');
    expect(siteHeader).toContain('aria-label="Mobil site navigasyonu"');
  });

  it("keeps tablet navigation on the drawer breakpoint", () => {
    const sidebar = source("src/components/app/app-sidebar.tsx");

    expect(sidebar).toContain('responsiveClassName="lg:hidden"');
    expect(sidebar).toContain(
      'bg-[linear-gradient(180deg,#0b1220_0%,#070d19_100%)] lg:flex',
    );
  });

  it("gives the billing switch a stable accessible name", () => {
    expect(source("src/components/pricing.tsx")).toContain(
      'aria-label="Yıllık faturalandırma"',
    );
  });

  it("describes every landing demo link as a scheduled meeting", () => {
    // Bölümler src/components/marketing altında ayrı dosyalardır: page + marketing/** + footer toplamı.
    const marketingFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? marketingFiles(`${dir}/${e.name}`) : /\.tsx$/.test(e.name) ? [`${dir}/${e.name}`] : [],
      );
    const home = [
      "src/app/page.tsx",
      ...marketingFiles("src/components/marketing"),
      "src/components/site-footer.tsx",
    ]
      .map(source)
      .join("\n");

    expect(home.match(/"\/demo"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(home.match(/Demo görüşmesi planla/gi)?.length).toBeGreaterThanOrEqual(3);
    expect(home.toLocaleLowerCase("tr-TR")).not.toContain("canlı demo");
  });

  it("uses keyboard-managed primitives for dense application popovers", () => {
    const notifications = source("src/components/app/notification-bell-panel.tsx");
    const transition = source("src/app/app/anlasmalar/status-transition.tsx");

    expect(notifications).toContain('from "@/components/ui/popover"');
    expect(notifications).toContain("<PopoverContent");
    expect(notifications).toContain('role="tablist"');
    expect(notifications).toContain('role="tabpanel"');
    expect(notifications).not.toContain('className="fixed inset-0');

    expect(transition).toContain('from "@/components/ui/dropdown-menu"');
    expect(transition).toContain("<DropdownMenuContent");
    expect(transition).not.toContain('className="fixed inset-0');
  });

  it("does not render missing public media URLs as deceptive hash links", () => {
    for (const file of [
      "src/app/vitrin/[slug]/[id]/page.tsx",
      "src/app/paylas/[token]/page.tsx",
    ]) {
      const content = source(file);
      expect(content, file).toContain("normalizeExternalHref");
      expect(content, file).not.toContain('external_url ?? "#"');
    }
  });

  it("labels icon-only geographic administration controls", () => {
    for (const file of [
      "src/app/admin/geo/province-row.tsx",
      "src/app/admin/geo/[provinceId]/district-row.tsx",
      "src/app/admin/geo/[provinceId]/[districtId]/neighborhood-row.tsx",
    ]) {
      const content = source(file);
      expect(content, file).toContain("aria-label=");
      expect(content, file).toContain('role="alert"');
      expect(content, file).not.toContain('{pending ? "..." : "Kaydet"}');
    }
  });

  it("announces shared route loading states without forcing motion", () => {
    const rootLoading = source("src/components/route-splash.tsx");
    const sharedSkeleton = source("src/components/ui/skeleton.tsx");

    expect(rootLoading).toContain('role="status"');
    expect(rootLoading).toContain('aria-busy="true"');
    expect(rootLoading).toContain("motion-safe:animate-pulse");
    expect(rootLoading).not.toContain('className="grid h-10 w-10 animate-pulse');

    expect(sharedSkeleton.match(/role="status"/g)).toHaveLength(3);
    expect(sharedSkeleton.match(/aria-busy="true"/g)).toHaveLength(3);
  });
});
