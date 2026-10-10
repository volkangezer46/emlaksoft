import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { getSettingDef } from "@/lib/settings/registry";
import { FEATURE_FLAGS } from "@/lib/feature-flags/registry";
import { ADMIN_EXTRA_PALETTE, ADMIN_NAV, activeAdminItem, activeTabHref, adminNavFor, adminPaletteFor, isAdminNavActive } from "./nav";
import { systemStatusOf } from "./system-status";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const pageFile = (href: string) => join(root, "src/app", href.split(/[?#]/)[0]!, "page.tsx");
const items = ADMIN_NAV.flatMap((s) => s.items);

describe("/admin menüsü (tek kaynak, bilgi mimarisi)", () => {
  it("4-6 iş grubu; her menü öğesi, sekme ve palet hedefi gerçek bir sayfadır", () => {
    expect(ADMIN_NAV.length).toBeGreaterThanOrEqual(4);
    expect(ADMIN_NAV.length).toBeLessThanOrEqual(6);
    const links = [...items, ...items.flatMap((i) => [...(i.tabs ?? []), ...(i.palette ?? [])]), ...ADMIN_EXTRA_PALETTE];
    for (const l of links) expect(existsSync(pageFile(l.href)), `${l.href} sayfası yok`).toBe(true);
    for (const i of items) expect(i.description.length, i.href).toBeGreaterThan(8);
  });

  it("eylem ve ayrıntı sayfaları menüde ayrı öğe değildir (yeni/oluştur listenin içinde)", () => {
    for (const i of items) {
      expect(i.href, i.href).not.toMatch(/\/(yeni|olustur|ekle)(\/|$)|\[id\]/);
      expect(i.label, i.label).not.toMatch(/^(Yeni|Oluştur|Ekle)\b/);
    }
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });

  it("Demo & aday kaldırıldı; eski /admin/satis self-servis deneme hunisine yönlenir", () => {
    const all = JSON.stringify(ADMIN_NAV);
    expect(all).not.toContain("/admin/satis");
    expect(all).not.toMatch(/Demo & aday/);
    expect(read("src/app/admin/satis/page.tsx")).toContain('redirect("/admin/tenants?durum=trial")');
    expect(read("src/app/admin/satis/[id]/page.tsx")).toContain('redirect("/admin/tenants?durum=trial")');
    for (const f of ["src/components/admin/admin-topbar.tsx", "src/components/admin/command-palette.tsx", "src/components/admin/admin-sidebar.tsx", "src/lib/admin-badges.ts"]) {
      expect(read(f), f).not.toMatch(/admin\/satis|demo_requests/);
    }
  });

  it("aktif vurgu: alt sayfa ve sekmeler kendi öğesini vurgular; Yeni ofis sayfasında Ofisler aktif", () => {
    expect(activeAdminItem("/admin/tenants/yeni")?.href).toBe("/admin/tenants");
    // Raporlar / AI danışmanı Kontrol panelinin, Üyeler Ofisler bölümünün sekmesidir (menü bütçesi).
    expect(activeAdminItem("/admin/raporlar")?.href).toBe("/admin");
    expect(activeAdminItem("/admin/danisman")?.href).toBe("/admin");
    expect(activeAdminItem("/admin/members/abc")?.href).toBe("/admin/tenants");
    expect(activeAdminItem("/admin/seo")?.href).toBe("/admin/site");
    expect(activeAdminItem("/admin/muhasebe/defter")?.href).toBe("/admin/billing");
    expect(activeAdminItem("/admin/aktivite")?.href).toBe("/admin/sistem");
    expect(activeAdminItem("/admin/ayarlar/bayraklar")?.href).toBe("/admin/ayarlar");
    expect(isAdminNavActive("/admin/tenants", { href: "/admin" })).toBe(false);
    expect(isAdminNavActive("/admin/sitex", { href: "/admin/site" })).toBe(false);
    const ayarlar = items.find((i) => i.href === "/admin/ayarlar")!;
    expect(activeTabHref("/admin/ayarlar/merkez", ayarlar.tabs!)).toBe("/admin/ayarlar/merkez");
  });

  it("rol süzgeci: görünür her öğe en az bir rol modülüyle eşleşir; destek rolü site/sistem görmez", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      for (const s of adminNavFor(mods)) for (const i of s.items) expect(i.modules.some((m) => mods.includes(m)), `${role} ${i.href}`).toBe(true);
    }
    const support = adminNavFor(PLATFORM_ROLE_MODULES.support).flatMap((s) => s.items.map((i) => i.href));
    expect(support).not.toContain("/admin/site");
    expect(support).not.toContain("/admin/sistem");
    const palette = adminPaletteFor(PLATFORM_ROLE_MODULES.super_admin).map((p) => p.href);
    expect(palette).toContain("/admin/tenants/yeni");
    expect(new Set(palette).size).toBe(palette.length);
  });

  it("sistem durumu çipi: veritabanı hatası kırmızı, hatalı cron amber, aksi yeşil", () => {
    expect(systemStatusOf({ ok: false, cronErrors: 0 }).level).toBe("down");
    expect(systemStatusOf({ ok: true, cronErrors: 2 })).toEqual({ level: "warn", label: "2 uyarı" });
    expect(systemStatusOf({ ok: true, cronErrors: null }).level).toBe("ok");
    expect(read("src/components/admin/admin-sidebar.tsx")).not.toContain("Sistem durumu</span>");
    expect(read("src/components/admin/admin-topbar.tsx")).toContain("<SystemStatusChip");
  });
});

describe("özellik bayrakları ve tek-yer ayarlar", () => {
  it("her ayar bayrağı defterde açık/kapalı ayardır; ortam bayrağının değerlendiricisi vardır", () => {
    for (const f of FEATURE_FLAGS) {
      if (f.source === "setting") expect(getSettingDef(f.settingKey!)?.type, f.key).toBe("bool");
      if (f.source === "env") expect(typeof f.env, f.key).toBe("function");
      if (f.requires) expect(FEATURE_FLAGS.some((g) => g.key === f.requires), f.key).toBe(true);
    }
    expect(new Set(FEATURE_FLAGS.map((f) => f.key)).size).toBe(FEATURE_FLAGS.length);
  });

  it("mesajlaşma yedeği aynası asıl kapıyla aynı ifadeyi kullanır", () => {
    const expr = 'ALLOW_PLATFORM_MESSAGING_FALLBACK?.trim().toLowerCase() === "true"';
    expect(read("src/lib/messaging/tenant-providers.ts")).toContain(expr);
    expect(read("src/lib/feature-flags/registry.ts")).toContain(expr);
    expect(read("src/app/actions/billing.ts")).toContain("billingDemoAllowed()");
    expect(read("src/app/actions/payment-links.ts")).toContain("paymentLinkDemoAllowed()");
  });

  it("konuya ait ayarın evi gerçek bir sayfadır ve o sayfa ayarı RegistrySettings ile çizer", () => {
    const homes = new Map<string, string[]>();
    for (const key of ["platform.registration_open", "platform.maintenance_mode", "billing.default_trial_days", "legal.lead_consent_text"]) {
      const home = getSettingDef(key)?.home;
      expect(home, key).toBeTruthy();
      expect(existsSync(pageFile(home!.href)), home!.href).toBe(true);
      homes.set(home!.href, [...(homes.get(home!.href) ?? []), key]);
    }
    expect(read("src/app/admin/sistem/system-view.tsx")).toContain('"platform.registration_open"');
    expect(read("src/app/admin/billing/page.tsx")).toContain('"billing.default_trial_days"');
    expect(read("src/app/admin/ayarlar/merkez/page.tsx")).toContain("getSettingDef(v.key)?.home");
    expect(existsSync(join(root, "src/app/admin/ayarlar/general-settings-form.tsx"))).toBe(false);
  });
});
