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

  it("Demo & aday kaldırıldı; eski satış CRM yolu iz bırakmadan silindi (yönlendirme yok)", () => {
    const all = JSON.stringify(ADMIN_NAV);
    expect(all).not.toMatch(/Demo & aday/);
    expect(read("next.config.ts")).not.toMatch(/source: "\/(app|admin)\//);
    for (const f of ["src/components/admin/admin-topbar.tsx", "src/components/admin/command-palette.tsx", "src/components/admin/admin-sidebar.tsx", "src/lib/admin-badges.ts"]) {
      expect(read(f), f).not.toMatch(/demo_requests/);
    }
  });

  it("aktif vurgu: alt sayfa ve sekmeler kendi öğesini vurgular; Yeni ofis sayfasında Ofisler aktif", () => {
    expect(activeAdminItem("/admin/tenants/yeni")?.href).toBe("/admin/tenants");
    // Raporlar / AI danışmanı Kontrol panelinin, Üyeler Ofisler bölümünün sekmesidir (menü bütçesi).
    expect(activeAdminItem("/admin/raporlar")?.href).toBe("/admin");
    expect(activeAdminItem("/admin/danisman")?.href).toBe("/admin");
    expect(activeAdminItem("/admin/members/abc")?.href).toBe("/admin/tenants");
    expect(activeAdminItem("/admin/site/seo")?.href).toBe("/admin/site");
    expect(activeAdminItem("/admin/billing/defter")?.href).toBe("/admin/billing");
    expect(activeAdminItem("/admin/aktivite")?.href).toBe("/admin/sistem");
    expect(activeAdminItem("/admin/ayarlar/bayraklar")?.href).toBe("/admin/ayarlar");
    expect(activeAdminItem("/admin/ai-kullanim")?.href).toBe("/admin/analiz-tarifesi");
    expect(activeAdminItem("/admin/tickets/yardim/duzenle")?.href).toBe("/admin/tickets");
    expect(activeAdminItem("/admin/geo/talepler")?.href).toBe("/admin/geo");
    expect(activeAdminItem("/admin/personel/guvenlik")?.href).toBe("/admin/personel");
    expect(isAdminNavActive("/admin/tenants", { href: "/admin" })).toBe(false);
    expect(isAdminNavActive("/admin/sitex", { href: "/admin/site" })).toBe(false);
    const ayarlar = items.find((i) => i.href === "/admin/ayarlar")!;
    expect(activeTabHref("/admin/ayarlar", ayarlar.tabs!)).toBe("/admin/ayarlar");
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

  it("konuya ait ayarın evi gerçek bir sayfadır; alan sahibi olmayan ayarlar (kayıt/bakım, deneme/yenileme) Ayar merkezindedir", () => {
    for (const key of ["legal.lead_consent_text", "email.resend_api_key", "dunning.auto_suspend_days"]) {
      const home = getSettingDef(key)?.home;
      if (!home) continue;
      expect(existsSync(pageFile(home.href)), home.href).toBe(true);
    }
    for (const key of ["platform.registration_open", "platform.maintenance_mode", "billing.default_trial_days", "billing.auto_renew_enabled"]) {
      const def = getSettingDef(key)!;
      expect(def.home, key).toBeUndefined();
      expect(["kayit-bakim", "deneme-yenileme"], key).toContain(def.category);
    }
    // Eski kopya formlar yok: sistem sağlığı ve abonelik genel ekranı bu ayarları düzenlemez (tek yer: /admin/ayarlar).
    expect(read("src/app/admin/sistem/system-view.tsx")).not.toContain('"platform.registration_open"');
    expect(read("src/app/admin/billing/page.tsx")).not.toContain('"billing.default_trial_days"');
    expect(read("src/app/admin/billing/page.tsx")).toContain("/admin/ayarlar?kategori=deneme-yenileme");
    expect(read("src/app/admin/ayarlar/page.tsx")).toContain("getSettingDef(v.key)?.home");
    expect(existsSync(join(root, "src/app/admin/ayarlar/general-settings-form.tsx"))).toBe(false);
  });
});

describe("tek sekme kaynağı ve kaldırılan kopyalar (CL-ADMIN)", () => {
  const byHref = new Map(items.map((i) => [i.href, i]));
  const labels = (href: string) => byHref.get(href)!.tabs!.map((t) => t.label);

  it("bölüm sekmeleri nav.ts'ten gelir; sayfa içi kopya sekme bileşenleri silindi", () => {
    expect(labels("/admin")).toEqual(["Panel", "Raporlar", "Rapor merkezi", "AI danışmanı", "Onaylar"]);
    expect(labels("/admin/billing")).toEqual(["Genel", "Planlar", "Kuponlar", "Tahsilat", "Muhasebe", "Fatura defteri", "Kanal ROI"]);
    expect(labels("/admin/tickets")).toEqual(["Talepler", "Hazır yanıtlar", "KVKK başvuruları", "Yardım merkezi", "Öneri panosu", "Raporlar", "Ayarlar"]);
    expect(labels("/admin/personel")).toEqual(["Personel", "Roller", "Güvenlik politikası"]);
    expect(labels("/admin/geo")).toEqual(["Gezgin", "İçe aktar", "Sürümler", "Değişiklik talepleri", "Veri tutarlılığı", "Eşleştir"]);
    expect(labels("/admin/sistem")).toEqual(["Sağlık", "Entegrasyonlar", "Hata kayıtları", "Uyarılar", "Durum sayfası", "Kaynaklar", "Veritabanı", "Veri gezgini", "Aktivite"]);
    expect(labels("/admin/analiz-tarifesi")).toEqual(["Analiz tarifesi", "AI kullanımı"]);
    for (const f of [
      "src/app/admin/billing/billing-nav.tsx",
      "src/app/admin/tickets/kvkk/tickets-tabs.tsx",
      "src/app/admin/personel/personel-tabs.tsx",
      "src/app/admin/geo/geo-tabs.tsx",
      "src/app/admin/geo/layout.tsx",
      "src/app/admin/sistem/emlakfiyati-view.tsx",
    ]) {
      expect(existsSync(join(root, f)), f).toBe(false);
    }
    expect(read("src/app/admin/sistem/page.tsx")).not.toMatch(/PageTabs|sekme=emlakfiyati|"emlakfiyati"|EmlakFiyatiView|sekme=portal-kurallari|"portal-kurallari"/);
    expect(read("src/app/admin/raporlar/page.tsx")).not.toContain("ReportTabs");
  });

  it("kupon sekmesi koşulludur (şema yoksa çizilmez); palet sekmelerden türer, elle hedef kopyası yok", () => {
    const kupon = byHref.get("/admin/billing")!.tabs!.find((t) => t.label === "Kuponlar")!;
    expect(kupon.when).toBe("coupons");
    const billing = (c: boolean) => adminNavFor(PLATFORM_ROLE_MODULES.super_admin, { coupons: c }).flatMap((s) => s.items).find((i) => i.href === "/admin/billing")!;
    expect(billing(false).tabs!.some((t) => t.label === "Kuponlar")).toBe(false);
    expect(billing(true).tabs!.some((t) => t.label === "Kuponlar")).toBe(true);
    const manual = items.flatMap((i) => i.palette ?? []).map((p) => p.href);
    for (const h of ["/admin/tickets/kvkk?kaynak=basvuru", "/admin/tickets/oneriler", "/admin/sistem?sekme=durum"]) expect(manual, h).not.toContain(h);
    const palette = adminPaletteFor(PLATFORM_ROLE_MODULES.super_admin).map((p) => p.href);
    for (const h of ["/admin/tickets/kvkk", "/admin/tickets/oneriler", "/admin/sistem?sekme=durum"]) expect(palette, h).toContain(h);
  });

  it("Gelir menüsü: Kullanım ve krediler (Analiz tarifesi + AI kullanımı) ve Ortaklık ve davet; AI kullanımı ayrı menü öğesi değil", () => {
    expect(byHref.get("/admin/analiz-tarifesi")?.label).toBe("Kullanım ve krediler");
    expect(byHref.has("/admin/ai-kullanim")).toBe(false);
    const ortak = byHref.get("/admin/ortaklik")!;
    expect(ortak.label).toBe("Ortaklık ve davet");
    expect(ortak.description).not.toMatch(/Site|SEO|Reklam/);
  });

  it("silinen rotaların klasörü yok (yönlendirme/takma ad bırakılmaz)", () => {
    for (const dir of ["site-icerik", "site-menu", "seo", "marka", "growth", "muhasebe", "ayarlar/merkez", "site/yardim", "geo/bildirimler", "site/seo/performans"]) {
      expect(existsSync(join(root, "src/app/admin", dir)), dir).toBe(false);
    }
  });
});
