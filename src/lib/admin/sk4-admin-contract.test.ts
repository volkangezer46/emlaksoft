import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ADMIN_TAB_PREFETCH_MAX, adminMobileTabs, adminTabPrefetchTargets } from "@/lib/admin/nav";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { FOUR_EYES_SETTING_DEFS } from "@/lib/settings/registry/four-eyes";
import { FIRST_RESPONSE_FILTER, awaitingFirstResponse, normalizeTicketFilters } from "@/app/admin/tickets/ticket-list-model";

/**
 * SK4 (REALTIME-2) kaynak sözleşmeleri: admin kabuğu (B022/B025/B135/B143/B145), sayaç tazeliği (B011), çift tazeleme
 * ve iyimser eylemler (B037), yetki (B122), Ofis 360 abonelik (B118), dört göz ayarları (B116), arama (B120/B192),
 * "İlk yanıt bekliyor" (B123).
 */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("admin kabuğu", () => {
  it("B022: kök Suspense/RouteSplash yok; dilimler kendi küçük sınırlarında", () => {
    const layout = read("src/app/admin/layout.tsx");
    expect(layout).not.toContain("<RouteSplash");
    expect(layout).not.toContain('from "@/components/route-splash"');
    for (const slice of ["<ShellSidebar />", "<ShellTopbar />", "<ShellTabs />", "<ShellStrips />", "<ShellBoot />"]) expect(layout).toContain(slice);
    // Sayfa (children) kabuk sorgularını beklemez: hiçbir Suspense children'ı sarmaz.
    expect(layout).not.toMatch(/<Suspense[^>]*>\s*<AdminShell/);
  });

  it("B145: 390 px alt çubukta Talepler ve Sistem sabit (süper admin, operasyon); menü + ≤4 yuva", () => {
    const superTabs = adminMobileTabs(PLATFORM_ROLE_MODULES.super_admin).map((i) => i.href);
    expect(superTabs).toHaveLength(4);
    expect(superTabs).toEqual(expect.arrayContaining(["/admin", "/admin/tickets", "/admin/sistem"]));
    // Rozet taşıyan (Ofisler: risk) kalan yuvayı alır; menü sırası korunur (yer değiştirmez).
    expect(superTabs).toEqual(["/admin", "/admin/tenants", "/admin/tickets", "/admin/sistem"]);
    const support = adminMobileTabs(PLATFORM_ROLE_MODULES.support).map((i) => i.href);
    expect(support).toContain("/admin/tickets");
    expect(support.length).toBeLessThanOrEqual(4);
    expect(read("src/components/admin/admin-sidebar.tsx")).toContain("adminMobileTabs(allowed)");
    expect(read("src/components/admin/admin-sidebar.tsx")).not.toContain(".slice(0, 4)");
  });

  it("B145: uyarı şeritleri mobilde tek satırlık özet (≤44 px)", () => {
    const layout = read("src/app/admin/layout.tsx");
    expect(layout).toContain("data-strip-summary");
    expect(layout).toMatch(/min-h-11[^"]*line-clamp-1|line-clamp-1/);
  });

  it("B025: kardeş sekmeler boşta önceden yüklenir (≤8); B143: kenar solması + etkin sekme ortalanır", () => {
    const sistem = ADMIN_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/sistem")!;
    const targets = adminTabPrefetchTargets(sistem.tabs!, "/admin/sistem");
    expect(targets).not.toContain("/admin/sistem");
    expect(targets.length).toBeLessThanOrEqual(ADMIN_TAB_PREFETCH_MAX);
    expect(new Set(targets).size).toBe(targets.length);
    const tabs = read("src/components/admin/admin-section-tabs.tsx");
    expect(tabs).toContain("useIdlePrefetch(");
    expect(tabs).toContain("strip-fade");
    expect(tabs).toContain("centerScrollLeft(");
  });

  it("B135: üst çubuk ve hamburger güvenli alana göre dolgulu", () => {
    const top = read("src/components/admin/admin-topbar.tsx");
    expect(top).toContain("pt-[env(safe-area-inset-top)]");
    expect(top).toContain("h-[calc(4rem+env(safe-area-inset-top))]");
    expect(top).toContain("pl-[max(4rem,calc(env(safe-area-inset-left)+3.25rem))]");
    expect(top).toContain("pr-[max(1rem,env(safe-area-inset-right))]");
    expect(read("src/app/admin/layout.tsx")).toContain("env(safe-area-inset-top))]");
  });
});

describe("sayaç tazeliği ve eylemler (B011/B037)", () => {
  it("pano: açık/acil talep önbellek dışında; kalan önbellek 10 sn", () => {
    const p = read("src/app/admin/_dashboards/platform-sections.tsx");
    expect(p).toContain("liveTicketCounts");
    expect(p).toContain("revalidate: 10");
    expect(p).not.toContain("summary.open_ticket_count");
  });

  it("talep / fatura / abonelik eylemleri admin sayaç etiketlerini düşürür; bildirimler yanıttan sonra", () => {
    for (const f of ["src/app/actions/tickets.ts", "src/app/actions/admin-ticket-ops.ts", "src/app/actions/support-desk.ts", "src/app/actions/platform-subscription-ops.ts"]) {
      expect(read(f), f).toContain("bustAdminCounters()");
    }
    const tickets = read("src/app/actions/tickets.ts");
    expect(tickets).toContain("afterSafe(");
    // Ofis adına talep: sahibi bulma + bildirim yanıtı bekletmez.
    const staffCreate = tickets.slice(tickets.indexOf("export async function createSupportTicketAsStaff"), tickets.indexOf("export async function updateTicketStatus"));
    expect(staffCreate).toContain("afterSafe(async () =>");
    expect(staffCreate).not.toMatch(/^\s{4}await notifyTenant/m);
  });

  it("çift tazeleme yok: eylem revalidatePath yapıyorsa istemci router.refresh çağırmaz", () => {
    for (const f of ["src/app/admin/tickets/[id]/ticket-detail-controls.tsx", "src/app/admin/tenants/[id]/crm-panel.tsx", "src/app/admin/tenants/[id]/subscription-panel.tsx"]) {
      expect(read(f), f).not.toMatch(/\brouter\.refresh\(\);/);
      expect(read(f), f).not.toContain("useRouter(");
    }
    expect(read("src/app/admin/tickets/[id]/ticket-detail-controls.tsx")).toContain("useOptimistic");
    expect(read("src/app/admin/tickets/[id]/ticket-detail-controls.tsx")).toContain('label: "Geri al"');
    expect(read("src/app/admin/tenants/[id]/crm-panel.tsx")).toContain("useOptimistic");
    const crm = read("src/app/actions/platform-crm.ts");
    const note = crm.slice(crm.indexOf("export async function saveTenantCrmNote"), crm.indexOf("export async function setTenantCrmNotePinned"));
    expect(note).toContain("afterSafe(");
    expect(note).not.toContain("tenantExists(");
  });
});

describe("yetki ve Ofis 360 (B122/B118)", () => {
  it("SK4 eylemleri yetkisizlikte yönlendirmez, { error } döner", () => {
    for (const f of ["src/app/actions/platform-subscription-ops.ts", "src/app/actions/platform-crm.ts", "src/app/actions/admin-ticket-ops.ts"]) {
      const src = read(f);
      expect(src, f).not.toContain("requirePlatformModule(");
      expect(src, f).toContain("guardPlatformAction(");
    }
  });

  it("düğmeler yetkiyle çizilir; sayfa başı pencere yalnız durum düzeltir ve tutarı sunucudan alır", () => {
    const page = read("src/app/admin/tenants/[id]/page.tsx");
    expect(page).toMatch(/platformCan\(staff, "billing", "write"\) \? <SubscriptionPanel/);
    expect(page).toMatch(/officeAdminCan\(staff, "export_vault"\) \? <ExportVault/);
    expect(page).toMatch(/impersonating \? \(\s*<form action=\{stopImpersonation\}>/);
    const panel = read("src/app/admin/tenants/[id]/subscription-panel.tsx");
    const head = panel.slice(panel.indexOf("export function SubscriptionPanel"), panel.indexOf("// Abonelik operasyon konsolu"));
    expect(head).toContain("previewAdminSetPlanStatus(");
    expect(head).not.toContain('name="plan"');
    expect(head).not.toContain("monthlyTry");
    expect(panel).not.toContain("«Abonelik değiştir»");
  });
});

describe("dört göz eşikleri (B116)", () => {
  it("eşikler Ayar merkezinde SettingField olarak düzenlenir (home yok); Onaylar Güvenlik'e bağlanır", () => {
    for (const d of FOUR_EYES_SETTING_DEFS) expect(d.home, d.key).toBeUndefined();
    expect(read("src/app/admin/onaylar/page.tsx")).toContain('href="/admin/ayarlar?kategori=guvenlik"');
  });
});

describe("arama ve etiketler (B120/B192)", () => {
  it("üye e-postası RPC ile; profiles.email sorgusu yok; talep no aranır; hata günlüğe düşer", () => {
    const route = read("src/app/api/admin/search/route.ts");
    expect(route).toContain('admin.rpc("admin_search_members"');
    expect(route).not.toMatch(/from\("profiles"\)[^;]*email/);
    expect(route).toContain("ticketNoQuery(q)");
    expect(route).toContain('orIlike(["subject", "ticket_no"], q)');
    expect(route).toContain("href: `/admin/members/${m.id}`");
    expect(route).toContain("logSearchError(");
    // İşlev henüz uygulanmamışsa (PGRST202 / 42883) ad aramasına düşer (kod migration'dan önce yayınlanabilir).
    expect(route).toMatch(/PGRST202[\s\S]*42883[\s\S]*\.ilike\("full_name", safeLike\(q\)\)/);
  });

  it("ham iç yol ve İngilizce etiket ekranda yok", () => {
    expect(read("src/app/admin/billing/page.tsx")).not.toContain("docs/runbooks/IYZICO_IADE.md");
    expect(read("src/app/admin/tickets/[id]/page.tsx")).not.toContain('"Ticket no"');
    expect(read("src/app/admin/tickets/[id]/page.tsx")).toContain('label="Talep no"');
    expect(read("src/app/admin/sistem/cron-history.tsx")).toContain("cronDetailView(");
  });
});

describe("İlk yanıt bekliyor (B123)", () => {
  it("süzgeç kabul edilir, doğrudan sorguya düşer (en eski önce); küme tanımı açık + ilk yanıt yok", () => {
    const f = normalizeTicketFilters({ durum: FIRST_RESPONSE_FILTER });
    expect(f.durum).toBe(FIRST_RESPONSE_FILTER);
    expect(f.sirala).toBe("created_at");
    expect(f.yon).toBe("asc");
    expect(awaitingFirstResponse({ status: "open", first_response_at: null })).toBe(true);
    expect(awaitingFirstResponse({ status: "in_progress", first_response_at: null })).toBe(true);
    expect(awaitingFirstResponse({ status: "open", first_response_at: "2026-10-15T10:00:00Z" })).toBe(false);
    expect(awaitingFirstResponse({ status: "resolved", first_response_at: null })).toBe(false);
    expect(read("src/app/admin/tickets/page.tsx")).toContain('.is("first_response_at", null)');
    expect(read("src/app/admin/_dashboards/support-home.tsx")).toContain("FIRST_RESPONSE_FILTER");
  });
});
