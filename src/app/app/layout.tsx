import { Suspense } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";
import "@/app/console.css";
import { SidebarBoot } from "@/components/ui/console/sidebar-boot";
import { UserMenu } from "@/components/ui/console/user-menu";
import { AppBreadcrumb } from "@/components/app/app-breadcrumb";
import { QuickCreateMenu } from "@/components/app/quick-create-menu";
import { filterNavBadgesByAccess, getNavBadges, getPlanUsage, tabCountsFromUsage } from "@/lib/nav-badges";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaffIdentity } from "@/lib/platform";
import { AppSidebar } from "@/components/app/app-sidebar";
import { CommandSearch } from "@/components/app/command-search";
import { NotificationBell } from "@/components/app/notification-bell";
import { ThemeController } from "@/components/theme-controller";
import { ThemeToggle } from "@/components/theme-toggle";
import { cookies } from "next/headers";
import { AppPrefetcher } from "@/components/app/app-prefetcher";
import { ToastProvider } from "@/components/app/toast-provider";
import { OpsImpersonationBanner } from "@/components/app/ops-impersonation-banner";
import { SectionTabs } from "@/components/app/section-tabs";
import { RealtimeRefresh } from "@/components/app/realtime-refresh";
import { KeyboardShortcuts } from "@/components/app/keyboard-shortcuts";
import { listMyNotifications } from "@/app/actions/notifications";
import { ErrorBoundary } from "@/components/error-boundary";
import { getOfficeScoreCached } from "@/lib/office-score";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import {
  effectiveCanAccessModule,
  effectiveHasPermission,
  getEffectivePermissions,
  immutableReadonlyPermissions,
} from "@/lib/permissions-effective";
import type { AppModule } from "@/lib/permissions";
import { planLabel } from "@/lib/billing/plans";
import { lockedHrefs } from "@/lib/billing/page-gates";
import { getAppActions } from "@/lib/palette-core";
import { parseUiPrefs, uiPrefCookieName, uiPrefsCss } from "@/lib/ui-prefs";

const NAV_MODULES: AppModule[] = [
  "dashboard",
  "customers",
  "demands",
  "properties",
  "matching",
  "commissions",
  "portals",
  "leak",
  "appointments",
  "tasks",
  "calls",
  "reports",
  "valuation",
  "compliance",
  "team",
  "billing",
  "support",
  "settings",
  // Sidebar bu modüllerin linklerini de içeriyor; listede olmayan modül
  // izinden bağımsız herkese gizli kalır (offers/contracts/… kayboluyordu).
  "campaigns",
  "contracts",
  "expenses",
  "offers",
  "targets",
  "open_house",
  "rentals",
  "projects",
  "network",
];

type OfficeSummary = {
  name?: string;
  plan?: string;
  status?: string;
  brand_color?: string | null;
  created_at?: string | null;
  slug?: string | null;
};

/** Bildirim listesi (requireActiveTenant zinciri) Suspense içinde akar. */
async function NotificationBellStream() {
  const notifications = await listMyNotifications().catch(() => []);
  return <NotificationBell initial={notifications} />;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const user = await getRequestUser();

  const impersonating = user?.app_metadata?.impersonating === true;
  const claimedTenantId = typeof user?.app_metadata?.tenant_id === "string"
    ? user.app_metadata.tenant_id.trim() || null
    : null;
  const impersonatedTenantPromise = user && impersonating && claimedTenantId
    ? supabase
        .from("tenants")
        .select("name, plan, status, brand_color, created_at, slug")
        .eq("id", claimedTenantId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  // Spekülatif başlangıç: JWT claim'indeki rol/tenant, middleware'de profile ile
  // birebir doğrulanıyor (canonicalTenantUser). İzin/skor/rozet sorgularını profil
  // beklemeden BAŞLAT; profil gelince claim ile eşleşmezse sonuçlar atılıp eski
  // (profil temelli) yoldan yeniden hesaplanır. Yetkisiz modül rozetleri aşağıda
  // etkin izinle süzülür → yetki kapısı gevşemez.
  const claimedRole = typeof user?.app_metadata?.role === "string" ? user.app_metadata.role.trim() : "";
  const canSpeculate = Boolean(user && !impersonating && claimedTenantId && claimedRole);
  const specPermsPromise = canSpeculate
    ? getEffectivePermissions(claimedTenantId, claimedRole, user!.id)
    : null;
  // B10: claim profille eşleşmezse bu promise hiç beklenmez; reddedilirse unhandled rejection olmasın.
  specPermsPromise?.catch(() => undefined);
  const specScorePromise = canSpeculate ? getOfficeScoreCached(claimedTenantId!).catch(() => null) : null;
  const specBadgesPromise = canSpeculate
    ? getNavBadges({ supabase, tenantId: claimedTenantId, userId: user!.id, role: claimedRole, accessible: NAV_MODULES }).catch(() => [])
    : null;

  // profile ve platformStaff ikisi de yalnız `user`'a bağlı, birbirine değil →
  // her navigasyonda seri iki round-trip yerine paralel (bootstrap hızlanır).
  const [{ data: profile }, platformStaff, { data: impersonatedTenant }] = await Promise.all([
    user
      ? supabase
          .from("profiles")
          .select("full_name, role, tenant_id, tenants(name, plan, status, brand_color, created_at, slug)")
          .eq("id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    getPlatformStaffIdentity(),
    impersonatedTenantPromise,
  ]);

  const tenant = profile?.tenants as
    | OfficeSummary
    | OfficeSummary[]
    | null
    | undefined;
  const profileOffice = (Array.isArray(tenant) ? tenant[0] : tenant) ?? undefined;
  const office = (impersonating ? impersonatedTenant : profileOffice) ?? undefined;
  const tenantId = impersonating
    ? claimedTenantId
    : ((profile?.tenant_id as string | undefined) ?? null);
  const effectiveRole = impersonating ? "readonly" : (profile?.role ?? "readonly"); // B12: profil yoksa en düşük yetki (fail-closed)
  // Beyaz etiket: ofisin marka rengi geçerliyse panel tema değişkenlerini override et
  const brandColor = office?.brand_color && /^#[0-9a-fA-F]{6}$/.test(office.brand_color) ? office.brand_color : null;
  const fullName = String(profile?.full_name ?? platformStaff?.full_name ?? "ES");
  const initials = fullName
    .split(/\s+/)
    .map((part: string) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const platformStaffFullAccess = Boolean(platformStaff && !impersonating);

  // Spekülatif sonuçlar yalnız claim == profil ise kullanılır (aksi halde eski yol).
  const speculationValid = Boolean(
    canSpeculate && profile && profile.tenant_id === claimedTenantId && profile.role === claimedRole,
  );
  const effectivePermsPromise = platformStaffFullAccess
    ? Promise.resolve(null)
    : impersonating
      ? Promise.resolve(immutableReadonlyPermissions())
      : speculationValid && specPermsPromise
        ? specPermsPromise
        : getEffectivePermissions(tenantId, effectiveRole, user?.id);
  // Skor (navigasyonlar arası cache'li, 3 dk; anahtar tenantId içerir).
  const scorePromise =
    speculationValid && specScorePromise
      ? specScorePromise
      : user && tenantId
        ? getOfficeScoreCached(tenantId).catch(() => null)
        : Promise.resolve(null);
  // Plan kullanım kartı (gerçek head-count) yalnız tenant+plana bağlı: profil gelir gelmez başlar.
  const usagePromise = user && tenantId && !platformStaffFullAccess ? getPlanUsage(supabase, tenantId, office?.plan).catch(() => []) : Promise.resolve([]);
  const [effectivePerms, scoreComputed, planUsage, specBadges] = await Promise.all([
    effectivePermsPromise,
    scorePromise,
    usagePromise,
    speculationValid && specBadgesPromise ? specBadgesPromise : Promise.resolve(null),
  ]);
  const officeScore: number | null = scoreComputed ? scoreComputed.score : null;
  const officeScoreLabel = scoreComputed ? scoreComputed.label : "—";
  const showNotifications = Boolean(user && tenantId);
  // Paket kilidi: menüde kilit simgesi gösterilecek sayfalar (platform personeli hariç)
  const lockedNavHrefs = platformStaffFullAccess
    ? []
    : lockedHrefs({ plan: office?.plan, trial: office?.status === "trial", tenantCreatedAt: office?.created_at });
  const accessibleModules = platformStaffFullAccess
    ? NAV_MODULES
    : NAV_MODULES.filter((mod) => effectiveCanAccessModule(effectivePerms ?? {}, mod));
  const canCreate = (mod: AppModule) =>
    platformStaffFullAccess || effectiveHasPermission(effectivePerms ?? {}, mod, "create");
  // Hızlı oluştur + komut paleti "Eylemler": yalnız "create" yetkili modüller.
  const creatableModules = NAV_MODULES.filter((mod) => accessibleModules.includes(mod) && canCreate(mod));
  const hasQuickCreate = getAppActions(creatableModules, "", lockedNavHrefs).length > 0;
  // Menü sayı rozetleri: gerçek veri; hata olursa rozet çıkmaz. Spekülatif sorgu
  // etkin izinle süzülür; geçersizse (claim != profil) eski sıralı yol çalışır.
  const navBadges = platformStaffFullAccess
    ? []
    : specBadges
      ? filterNavBadgesByAccess(specBadges, accessibleModules)
      : await getNavBadges({ supabase, tenantId, userId: user?.id ?? null, role: effectiveRole, accessible: accessibleModules }).catch(() => []);
  // Sekme sayaçları: yalnız mevcut head-count'lar (müşteri/portföy/ekip); sayı yoksa gösterilmez.
  const tabCounts = tabCountsFromUsage(planUsage);
  const vitrinHref = office?.slug && !impersonating ? `/vitrin/${office.slug}` : null;

  const jar = await cookies();
  const impersonationCookieMatches = jar.get(IMPERSONATE_COOKIE)?.value === tenantId;
  // Arayüz tercihi (Sade görünüm + yazı boyutu): ofis+kullanıcı kapsamlı çerez, SSR'da uygulanır.
  const uiPrefCookie = uiPrefCookieName(tenantId, user?.id);
  const uiPrefs = parseUiPrefs(uiPrefCookie ? jar.get(uiPrefCookie)?.value : undefined);
  const uiCss = uiPrefsCss(uiPrefs.font);
  const impName = impersonationCookieMatches
    ? (jar.get("es_impersonate_name")?.value ?? office?.name ?? "Hedef ofis")
    : (office?.name ?? "Hedef ofis");

  return (
    <ToastProvider>
      <ThemeController />
      {uiCss ? <style>{uiCss}</style> : null}
      <SidebarBoot />
      <ErrorBoundary>
        {brandColor ? (
          <style>{`.brand-scope{--brand-600:${brandColor};--brand-700:color-mix(in srgb,${brandColor} 80%,#000);--brand-500:color-mix(in srgb,${brandColor} 86%,#fff);--brand-400:color-mix(in srgb,${brandColor} 68%,#fff);--brand-300:color-mix(in srgb,${brandColor} 42%,#fff);--grad-brand:linear-gradient(120deg,${brandColor},var(--cyan-400) 55%,var(--mint-500));--shadow-glow-brand:0 20px 50px -18px color-mix(in srgb,${brandColor} 55%,transparent);}`}</style>
        ) : null}
        <div className={`flex min-h-screen bg-canvas${brandColor ? " brand-scope" : ""}`}>
          <AppPrefetcher tenantId={tenantId} />
          <RealtimeRefresh tenantId={tenantId} />
          {/* Klavye kisayollari: komut paleti (Ctrl+K) zaten vardi ama tek
              kisayol oydu. "g" onekli iki tusluk dizi bilincli — tek harf,
              bir nota yazarken odak kaybolursa sayfayi degistirip yazilani
              kaybettirir. Detay: keyboard-shortcuts.tsx */}
          <KeyboardShortcuts />
        <AppSidebar
          officeName={office?.name ?? "EmlakSoft Ofis"}
          plan={planLabel(office?.plan ?? "office")}
          trial={office?.status === "trial"}
          accessibleModules={accessibleModules}
          creatableModules={creatableModules}
          lockedHrefs={lockedNavHrefs}
          badges={navBadges}
          usage={planUsage}
          canUpgrade={accessibleModules.includes("billing") && !platformStaffFullAccess && (office?.plan ?? "office") !== "enterprise"}
          vitrinHref={vitrinHref}
          storageScope={user && tenantId ? `${tenantId}:${user.id}` : undefined}
          role={platformStaffFullAccess ? "owner" : effectiveRole}
          simple={uiPrefs.simple}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {impersonating && platformStaff ? <OpsImpersonationBanner tenantName={impName || office?.name || "Ofis"} /> : null}
          <header className="glass-bar sticky top-0 z-30 flex h-14 items-center justify-between gap-3 px-4 pl-16 lg:px-6">
            <AppBreadcrumb accessibleModules={accessibleModules} />
            <CommandSearch accessibleModules={accessibleModules} creatableModules={creatableModules} lockedHrefs={lockedNavHrefs} storageScope={user && tenantId ? `${tenantId}:${user.id}` : undefined} />
            <div className="ml-3 flex shrink-0 items-center gap-1.5 sm:ml-4 sm:gap-2">
              <ThemeToggle />
              {/* Hızlı eylem menüsü: en sık kullanılan kayıt akışlarına tek tıkla */}
              {hasQuickCreate ? <QuickCreateMenu creatableModules={creatableModules} lockedHrefs={lockedNavHrefs} /> : null}
              <Link
                href="/app/raporlar"
                title="Kural tabanlı ofis skoru (yapay zekâ değil): açık talepler, canlı portal ilanları, son 7 günün randevu ve aramaları ile son 30 günün kapanışları puan ekler; gecikmiş portal teyitleri puan düşürür. Başlangıç 42. Rapor merkezini açmak için tıklayın."
                className="focus-ring hidden items-center gap-2 rounded-full border border-mint-500/20 bg-mint-500/10 px-3 py-1.5 text-xs font-semibold text-mint-600 transition hover:border-mint-500/45 hover:bg-mint-500/15 xl:flex"
              >
                <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-500" />
                {officeScore != null ? `Ofis skoru ${officeScore} · ${officeScoreLabel}` : "Ofis skoru —"}
              </Link>
              {platformStaffFullAccess ? (
                <Link
                  href="/admin"
                  className="hidden items-center gap-1.5 rounded-[var(--radius-control)] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-700 transition hover:border-amber-400/50 lg:inline-flex"
                  title="EmlakSoft Süper Admin"
                >
                  <Shield className="h-3.5 w-3.5" /> Ops
                </Link>
              ) : null}
              {/* Bildirimler sayfayı bloke etmez: kabuk anında gider, liste akar */}
              {showNotifications ? (
                <Suspense fallback={<NotificationBell initial={[]} />}>
                  <NotificationBellStream />
                </Suspense>
              ) : (
                <NotificationBell initial={[]} />
              )}
              <UserMenu
                initials={initials}
                name={fullName}
                subtitle={`${planLabel(office?.plan ?? "office")} plan`}
                links={accessibleModules.includes("settings") ? [{ href: "/app/ayarlar", label: "Ayarlar", iconName: "settings" as const }] : []}
                viewPrefs={uiPrefCookie ? { cookieName: uiPrefCookie, initial: uiPrefs } : undefined}
              />
            </div>
          </header>
          {/* grid + minmax(0,1fr): her doğrudan çocuk (SectionTabs + sayfa)
              tam olarak kullanılabilir genişliğe sabitlenir; içteki geniş tablonun
              overflow-x-auto kabı düzgün kaydırılır ve belgeyi (ICB'yi) şişiremez.
              iOS Safari `overflow:clip`'i viewport'a propagate etmiyor (sayfa yana
              kayıyordu) — minmax(0,1fr) track bunu kökten keser. */}
          <main
            id="main-content"
            className="grid min-w-0 max-w-full flex-1 grid-cols-[minmax(0,1fr)] content-start overflow-x-clip p-4 pb-28 md:px-6 md:pt-6 lg:p-8"
          >
            <SectionTabs accessibleModules={accessibleModules} lockedHrefs={lockedNavHrefs} counts={tabCounts} />
            {/* Sayfa içi sekme alanları (InlineTabbedPanel) buraya yerleşir: popup değil, akışta. */}
            <div id="inline-panel-host" className="min-w-0" />
            {children}
          </main>
        </div>
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
}
