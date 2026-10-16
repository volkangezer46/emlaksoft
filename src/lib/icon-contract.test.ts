import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BRAND_ICONS } from "@/components/ui/icons/brand-icons";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { ADMIN_TAB_ICON_HREFS, adminTabIcon } from "@/lib/admin/tab-icons";
import { ICONS, TAB_ICONS } from "@/lib/icons";
import { hubNav, NAV_SECTIONS } from "@/lib/nav-config";
import { shellIcon } from "@/lib/nav-shell-server";
import type { AppModule } from "@/lib/permissions";

/**
 * İKON SÖZLEŞMESİ (premium v5): menü öğeleri, bölüm/sekme şeritleri ve ikon sözlükleri her zaman çizilebilir bir SVG
 * ikonu taşır; marka ikon seti lucide ile aynı çizgi dilindedir ve sunucu menü serileştirmesinden geçer.
 */
const svg = (icon: unknown) => renderToStaticMarkup(createElement(icon as ComponentType<{ className?: string }>, { className: "t" }));
const isSvg = (icon: unknown) => icon != null && /^<svg[\s\S]*<\/svg>$/.test(svg(icon));

const ALL_MODULES: AppModule[] = [
  "dashboard", "customers", "demands", "matching", "commissions", "offers", "contracts", "calls",
  "appointments", "tasks", "properties", "portals", "open_house", "rentals", "network", "projects",
  "valuation", "expenses", "billing", "reports", "targets", "leak", "team", "settings", "campaigns",
  "compliance", "support",
];
const ROLES = ["owner", "manager", "branch_manager", "team_lead", "agent", "call_center", "accountant", "viewer"];

describe("ikon sözleşmesi", () => {
  it("/app katalog: her başlık, sayfa ve sekme ikonludur (çizilebilir SVG)", () => {
    const missing: string[] = [];
    for (const s of NAV_SECTIONS) {
      if (!isSvg(s.icon)) missing.push(`başlık:${s.title}`);
      for (const i of s.items) {
        if (!isSvg(i.icon)) missing.push(i.label);
        for (const t of i.tabs ?? []) if (!isSvg(t.icon)) missing.push(`sekme:${t.label}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("/app rol menüleri: her merkez, sekme sayfası ve araç ikonludur (tüm roller, şubeli ve şubesiz ofis)", () => {
    const missing: string[] = [];
    for (const role of ROLES) {
      for (const hasBranches of [false, true]) {
        const nav = hubNav(ALL_MODULES, { role, hasBranches });
        for (const h of [...nav.hubs, ...nav.dock]) {
          if (!isSvg(h.icon)) missing.push(`${role}:${h.label}`);
          for (const p of h.pages) if (!isSvg(p.icon)) missing.push(`${role}:${h.label}>${p.label}`);
        }
        for (const t of nav.tools) if (!isSvg(t.icon)) missing.push(`${role}:araç:${t.label}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("/admin: her menü öğesi ve her bölüm sekmesi ikonludur; sekme eşlemesi ölü yol içermez", () => {
    const missing: string[] = [];
    const tabHrefs = new Set<string>();
    for (const s of ADMIN_NAV) {
      for (const i of s.items) {
        if (!isSvg(i.icon)) missing.push(i.label);
        for (const t of i.tabs ?? []) {
          tabHrefs.add(t.href);
          if (!isSvg(adminTabIcon(t.href, i.icon))) missing.push(`sekme:${t.label}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // Eşlenmemiş sekme yedeğe düşer; yeni sekme eklenince eşlemeye de eklenmesi beklenir (yedek yalnız güvenlik ağı).
    const unmapped = [...tabHrefs].filter((h) => !ADMIN_TAB_ICON_HREFS.includes(h));
    expect(unmapped).toEqual([]);
  });

  it("ikon sözlükleri (ICONS, TAB_ICONS) yalnız çizilebilir ikon içerir", () => {
    for (const [k, v] of [...Object.entries(ICONS), ...Object.entries(TAB_ICONS)]) expect(isSvg(v), k).toBe(true);
  });

  it("marka ikon seti: lucide çizgi dili (24 px, currentColor, 2 px), tek duotone katman, küçük, sunucu serileştirmesinden geçer", () => {
    expect(Object.keys(BRAND_ICONS).length).toBeGreaterThanOrEqual(12);
    const seen = new Set<string>();
    for (const [k, icon] of Object.entries(BRAND_ICONS)) {
      const html = svg(icon);
      expect(html, k).toContain('viewBox="0 0 24 24"');
      expect(html, k).toContain('stroke="currentColor"');
      expect(html, k).toContain('stroke-width="2"');
      expect(html, k).toMatch(/class="lucide lucide-es-/);
      expect(html.match(/opacity="0\.16"/g)?.length ?? 0, `${k} duotone`).toBeLessThanOrEqual(1);
      expect(html, k).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      expect(html.length, k).toBeLessThan(1100);
      const node = shellIcon(icon);
      expect(node.cls, k).toContain("lucide-es-");
      expect(node.node.length, k).toBeGreaterThan(1);
      seen.add(html);
    }
    expect(seen.size).toBe(Object.keys(BRAND_ICONS).length);
  });

  it("emlak kavramları sözlükte marka ikonuyla eşlenir", () => {
    expect(ICONS.komisyon).toBe(BRAND_ICONS.komisyon);
    expect(ICONS.aidat).toBe(BRAND_ICONS.aidat);
    expect(ICONS.anahtar).toBe(BRAND_ICONS.anahtar);
    expect(ICONS.eslestirme).toBe(BRAND_ICONS.eslesme);
    for (const k of ["tapu", "yerGosterme", "kira", "eids", "ilanPortal", "degerleme", "mulkSahibi", "imza"] as const) {
      expect(ICONS[k]).toBe(BRAND_ICONS[k]);
    }
  });
});
