import { Suspense, cache } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";
import "@/app/console.css";
import { SidebarBoot } from "@/components/ui/console/sidebar-boot";
import { UserMenu } from "@/components/ui/console/user-menu";
import { AppBreadcrumb } from "@/components/app/app-breadcrumb";
import { QuickCreateMenu } from "@/components/app/quick-create-menu";
import { filterNavBadgesByAccess, getNavBadges, getPlanUsage, tabCountsFromUsage } from "@/lib/nav-badges";
import { DAY_MS, msUntil } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaffIdentity } from "@/lib/platform";
import { AppSidebar } from "@/components/app/app-sidebar";
import { CommandSearch } from "@/components/app/command-search";
import { NotificationBell } from "@/components/app/notification-bell";
import { EfCreditBadge } from "@/components/app/ef-credit-badge";
import { ThemeController } from "@/components/theme-controller";
import { ThemeToggle } from "@/components/theme-toggle";
import { cookies } from "next/headers";
import { ProductTourLazy } from "./product-tour-lazy";
import { ToastProvider } from "@/components/app/toast-provider";
import { OpsImpersonationBanner } from "@/components/app/ops-impersonation-banner";
import { DemoTrialStrip } from "@/components/app/demo-trial-strip";
import { canSwitchToRealUse } from "@/lib/sample-data/real-use";
import { SectionTabs, SectionTabsPlaceholder } from "@/components/app/section-tabs";
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
  mergeEffectivePermissions,
} from "@/lib/permissions-effective";
import { loadShellBootstrap, shellRpcKnownMissing } from "@/lib/app-shell/bootstrap";
import { navBadgesFromCounts, usageRowsFromCounts } from "@/lib/app-shell/bootstrap-core";
import { resolveModuleState } from "@/lib/modules/logic";
import type { AppModule } from "@/lib/permissions";
import { planLabel } from "@/lib/billing/plans";
import { lockedHrefs } from "@/lib/billing/page-gates";
import { getAppActions } from "@/lib/palette-core";
import { ClosedModulesProvider } from "@/components/app/closed-modules-context";
import { getClosedFeatures } from "@/lib/modules/state";
import { Skeleton } from "@/components/ui/skeleton";
import { getRequestIdentity } from "@/lib/cache/request";
import { measure } from "@/lib/server-timing";
import { parseUiPrefs, uiPrefCookieName } from "@/lib/ui-prefs";
import { FontScaleBoot } from "@/components/font-scale-boot";
import { FONT_SCALE_COOKIE, FONT_SCALE_META_KEY, resolveFontScale } from "@/lib/font-scale";

/** Sekme başlığı: sayfalar `metadata.title` verir, şablon ofis uygulamasında "Sayfa · EmlakSoft" üretir. */
export const metadata = { title: { default: "EmlakSoft", template: "%s · EmlakSoft" } };

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
  "surveys",
];

type OfficeSummary = {
  name?: string;
  plan?: string;
  status?: string;
  brand_color?: string | null;
  created_at?: string | null;
  slug?: string | null;
  trial_ends_at?: string | null;
  sample_seeded_at?: string | null;
};

/** Bildirim listesi (requireActiveTenant zinciri) Suspense içinde akar. */
async function NotificationBellStream() {
  const notifications = await listMyNotifications().catch(() => []);
  return <NotificationBell initial={notifications} />;
}

/** Ofis skoru rozeti: kabuğu BEKLETMEZ (ilk hesap 5 sorgu; 3 dk önbellekli), kendi sınırında akar. */
async function OfficeScoreBadge({ tenantId }: { tenantId: string | null }) {
  const score = tenantId ? await getOfficeScoreCached(tenantId).catch(() => null) : null;
  return <OfficeScoreLink text={score ? `Ofis skoru ${score.score} · ${score.label}` : "Ofis skoru —"} />;
}

function OfficeScoreLink({ text }: { text: string }) {
  return (
    <Link
      href="/app/raporlar"
      title="Kural tabanlı ofis skoru (yapay zekâ değil): açık talepler, canlı portal ilanları, son 7 günün randevu ve aramaları ile son 30 günün kapanışları puan ekler; gecikmiş portal teyitleri puan düşürür. Başlangıç 42. Rapor merkezini açmak için tıklayın."
      className="focus-ring hidden items-center gap-2 rounded-full border border-mint-500/20 bg-mint-500/10 px-3 py-1.5 text-xs font-semibold text-mint-600 transition hover:border-mint-500/45 hover:bg-mint-500/15 xl:flex"
    >
      <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-500" />
      {text}
    </Link>
  );
}

/**
 * Kabuk modeli: oturum/izin/modül/kullanım/rozet hesabı TEK yerde, istek başına bir kez (React `cache()`).
 * Kenar çubuğu, üst çubuk, sekme şeridi ve boot dilimi aynı modeli bekler; sayfa (`children`) BEKLEMEZ.
 *
 * Veri yolu: `app_shell_bootstrap` RPC'si varsa profil/izin/modül/kullanım/rozet TEK turda gelir
 * (src/lib/app-shell); yoksa eski yol (spekülatif izin/rozet + istek-içi tek kimlik okuması + kullanım + modül) çalışır.
 */
const loadShellModel = cache(() => measure("app-shell", buildShellModel));

async function buildShellModel() {
  const supabase = await createClient();
  const user = await getRequestUser();

  const impersonating = user?.app_metadata?.impersonating === true;
  const claimedTenantId = typeof user?.app_metadata?.tenant_id === "string"
    ? user.app_metadata.tenant_id.trim() || null
    : null;
  const impersonatedTenantPromise = user && impersonating && claimedTenantId
    ? supabase
        .from("tenants")
        .select("name, plan, status, brand_color, created_at, slug, trial_ends_at, sample_seeded_at")
        .eq("id", claimedTenantId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  // HIZLI YOL: tek tur kabuk RPC'si (`app_shell_bootstrap`: profil + ofis + ham izin satırları + modüller +
  // kullanım + rozet sayımları). Impersonation'da çağrılmaz (RPC zaten NULL verir; eski yol readonly tavanını kurar).
  // RPC yoksa (migration henüz uygulanmadı) `null` döner ve aşağıdaki eski yol aynen çalışır.
  const bootPromise = user && !impersonating ? measure("app-shell-rpc", () => loadShellBootstrap()) : Promise.resolve(null);

  // Spekülatif başlangıç (ESKİ yol, yalnız RPC'nin bu süreçte eksik olduğu bilinirken; yoksa RPC'nin yanında
  // boşa sorgu atardı): JWT claim'indeki rol/tenant, proxy'de profile ile birebir doğrulanıyor
  // (canonicalTenantUser). İzin/rozet sorgularını profil beklemeden BAŞLAT; profil gelince claim ile
  // eşleşmezse sonuçlar atılıp eski (profil temelli) yoldan yeniden hesaplanır. Yetkisiz modül rozetleri
  // aşağıda etkin izinle süzülür → yetki kapısı gevşemez.
  const claimedRole = typeof user?.app_metadata?.role === "string" ? user.app_metadata.role.trim() : "";
  const canSpeculate = Boolean(user && !impersonating && claimedTenantId && claimedRole) && shellRpcKnownMissing();
  const specPermsPromise = canSpeculate
    ? getEffectivePermissions(claimedTenantId, claimedRole, user!.id)
    : null;
  // B10: claim profille eşleşmezse bu promise hiç beklenmez; reddedilirse unhandled rejection olmasın.
  specPermsPromise?.catch(() => undefined);
  const specBadgesPromise = canSpeculate
    ? getNavBadges({ supabase, tenantId: claimedTenantId, userId: user!.id, role: claimedRole, accessible: NAV_MODULES }).catch(() => [])
    : null;

  // boot, platformStaff, impersonatedTenant ve (yedek) kimlik okuması yalnız `user`'a bağlı → tek turda paralel.
  const [boot, platformStaff, { data: impersonatedTenant }, identityRes] = await Promise.all([
    bootPromise,
    getPlatformStaffIdentity(),
    impersonatedTenantPromise,
    // Kimlik satırı istek-içi TEK okumadır (sayfa kapısı/requireActiveTenant aynı sonucu paylaşır).
    user ? getRequestIdentity(user.id) : Promise.resolve({ data: null, error: null }),
  ]);
  type ShellProfile = { full_name: string | null; role: string | null; tenant_id: string | null; tenants: OfficeSummary | null };
  const identity = identityRes.data;
  // Profil: RPC'den (tek tur) ya da istek-içi kimlik okumasından (RPC yok / impersonation / RPC NULL verdi).
  const profile: ShellProfile | null = boot
    ? { full_name: boot.profile.fullName, role: boot.profile.role, tenant_id: boot.profile.tenantId, tenants: boot.office as OfficeSummary | null }
    : identity
      ? {
          full_name: identity.full_name,
          role: identity.role,
          tenant_id: identity.tenant_id,
          tenants: identity.tenant
            ? {
                name: identity.tenant.name ?? undefined,
                plan: identity.tenant.plan ?? undefined,
                status: identity.tenant.status ?? undefined,
                brand_color: identity.tenant.brand_color,
                created_at: identity.tenant.created_at,
                slug: identity.tenant.slug,
                trial_ends_at: identity.tenant.trial_ends_at,
                sample_seeded_at: identity.tenant.sample_seeded_at,
              }
            : null,
        }
      : null;

  const profileOffice = profile?.tenants ?? undefined;
  const office = ((impersonating ? impersonatedTenant : profileOffice) ?? undefined) as OfficeSummary | undefined;
  const tenantId = impersonating
    ? claimedTenantId
    : (profile?.tenant_id ?? null);
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
  // Kabuk RPC verisi yalnız profil/tenant ile birebir tutarlıysa kullanılır (aksi halde eski sorgular).
  const bootUsable = Boolean(boot && !impersonating && tenantId && boot.profile.tenantId === tenantId && boot.profile.role === effectiveRole);
  const effectivePermsPromise = platformStaffFullAccess
    ? Promise.resolve(null)
    : impersonating
      ? Promise.resolve(immutableReadonlyPermissions())
      : bootUsable && boot
        ? Promise.resolve(mergeEffectivePermissions(effectiveRole, boot.roleOverrides, boot.userOverrides))
        : speculationValid && specPermsPromise
          ? specPermsPromise
          : getEffectivePermissions(tenantId, effectiveRole, user?.id);
  // Plan kullanım kartı (gerçek sayım) yalnız tenant+plana bağlı: RPC'den ya da head-count sorgularından.
  const usagePromise =
    user && tenantId && !platformStaffFullAccess
      ? bootUsable && boot
        ? Promise.resolve(usageRowsFromCounts(office?.plan, boot.usage))
        : getPlanUsage(supabase, tenantId, office?.plan).catch(() => [])
      : Promise.resolve([]);
  // Ofisin kapattığı modüller (menü, sekme, palet ve hızlı oluşturmadan çıkar). Platform personeli etkilenmez.
  const closedModulesPromise: Promise<string[]> =
    tenantId && !platformStaffFullAccess
      ? bootUsable && boot
        ? Promise.resolve(resolveModuleState(boot.modules).closed)
        : getClosedFeatures(tenantId).catch(() => [])
      : Promise.resolve([]);
  const [effectivePerms, planUsage, specBadges, closedModules, jar] = await Promise.all([
    effectivePermsPromise,
    usagePromise,
    speculationValid && specBadgesPromise ? specBadgesPromise : Promise.resolve(null),
    closedModulesPromise,
    cookies(),
  ]);
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
  const hasQuickCreate = getAppActions(creatableModules, "", lockedNavHrefs, closedModules).length > 0;
  // Menü sayı rozetleri: gerçek veri; hata olursa rozet çıkmaz. Spekülatif sorgu
  // etkin izinle süzülür; geçersizse (claim != profil) eski sıralı yol çalışır.
  const navBadges = platformStaffFullAccess
    ? []
    : bootUsable && boot
      ? navBadgesFromCounts({ counts: boot.badges, role: effectiveRole, accessible: accessibleModules })
      : specBadges
        ? filterNavBadgesByAccess(specBadges, accessibleModules)
        : await getNavBadges({ supabase, tenantId, userId: user?.id ?? null, role: effectiveRole, accessible: accessibleModules }).catch(() => []);
  // Sekme sayaçları: yalnız mevcut head-count'lar (müşteri/portföy/ekip); sayı yoksa gösterilmez.
  const tabCounts = tabCountsFromUsage(planUsage);
  const vitrinHref = office?.slug && !impersonating ? `/vitrin/${office.slug}` : null;

  const impersonationCookieMatches = jar.get(IMPERSONATE_COOKIE)?.value === tenantId;
  // Arayüz tercihi (Sade görünüm): ofis+kullanıcı kapsamlı çerez, SSR'da uygulanır.
  const uiPrefCookie = uiPrefCookieName(tenantId, user?.id);
  const uiPrefs = parseUiPrefs(uiPrefCookie ? jar.get(uiPrefCookie)?.value : undefined);
  // Yazı boyutu: kullanıcıya bağlı çerez > auth metadata > Normal (başka hesabın çerezi yok sayılır).
  const fontScale = resolveFontScale({
    userId: user?.id,
    cookieValue: jar.get(FONT_SCALE_COOKIE)?.value,
    metadataValue: user?.user_metadata?.[FONT_SCALE_META_KEY],
  });
  // Deneme sayacı tek kez hesaplanır: yan menü ve kabuk şeridi aynı sayıyı gösterir.
  const trialDaysLeft = office?.status === "trial" && office.trial_ends_at ? Math.max(0, Math.ceil(msUntil(office.trial_ends_at) / DAY_MS)) : null;
  const impName = impersonationCookieMatches
    ? (jar.get("es_impersonate_name")?.value ?? office?.name ?? "Hedef ofis")
    : (office?.name ?? "Hedef ofis");

  return {
    userId: user?.id ?? null,
    impersonating,
    platformStaff,
    platformStaffFullAccess,
    office,
    tenantId,
    effectiveRole,
    effectivePerms,
    brandColor,
    fullName,
    initials,
    accessibleModules,
    creatableModules,
    hasQuickCreate,
    lockedNavHrefs,
    closedModules,
    navBadges,
    planUsage,
    tabCounts,
    vitrinHref,
    uiPrefCookie,
    uiPrefs,
    fontScale,
    impName,
    trialDaysLeft,
    storageScope: user && tenantId ? `${tenantId}:${user.id}` : undefined,
  };
}

/**
 * Kabuk dilimleri AYRI Suspense sınırlarında akar; sayfa (`children`) kabuk verisini BEKLEMEZ:
 * çerçeve (kenar çubuğu/üst çubuk iskeleti + main) ilk baytta gider, sayfa kendi loading.tsx'iyle paralel akar.
 * Eskiden tek <Suspense fallback={<RouteSplash/>}> kabuk + sayfayı birlikte bekletiyordu (sayfa sorguları kabuk
 * sorgularından SONRA başlıyordu).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ThemeController />
      <SidebarBoot />
      <ErrorBoundary>
        <div className="app-frame flex min-h-screen bg-canvas">
          <Suspense fallback={null}>
            <ShellBoot />
          </Suspense>
          <Suspense fallback={<SidebarSkeleton />}>
            <ShellSidebar />
          </Suspense>
          <div className="flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<HeaderSkeleton />}>
              <ShellHeader />
            </Suspense>
            {/* grid + minmax(0,1fr): her doğrudan çocuk (SectionTabs + sayfa)
                tam olarak kullanılabilir genişliğe sabitlenir; içteki geniş tablonun
                overflow-x-auto kabı düzgün kaydırılır ve belgeyi (ICB'yi) şişiremez.
                iOS Safari `overflow:clip`'i viewport'a propagate etmiyor (sayfa yana
                kayıyordu) — minmax(0,1fr) track bunu kökten keser. */}
            <main
              id="main-content"
              className="grid min-w-0 max-w-full flex-1 grid-cols-[minmax(0,1fr)] content-start overflow-x-clip p-4 pb-28 md:px-6 md:pt-6 lg:p-8"
            >
              <Suspense fallback={<SectionTabsPlaceholder allModules={NAV_MODULES} />}>
                <ShellTabs />
              </Suspense>
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

/**
 * Görünmez kabuk parçaları: yazı boyutu, beyaz etiket rengi, ürün turu, canlı yenileme, klavye kısayolları.
 * Beyaz etiket: `[data-brand-scope]` işaretçisi çerçevenin DOĞRUDAN çocuğudur; tokens.css/a11y.css
 * `.app-frame:has(> [data-brand-scope])` ile `.brand-scope` kurallarını aynen uygular (çerçeve sınıfı
 * veri beklemeden çizilebilsin diye).
 */
async function ShellBoot() {
  const m = await loadShellModel();
  return (
    <ClosedModulesProvider closed={m.closedModules}>
      <FontScaleBoot scale={m.fontScale} />
      {m.brandColor ? (
        <>
          <style>{`.app-frame:has(> [data-brand-scope]){--brand-600:${m.brandColor};--brand-700:color-mix(in srgb,${m.brandColor} 80%,#000);--brand-500:color-mix(in srgb,${m.brandColor} 86%,#fff);--brand-400:color-mix(in srgb,${m.brandColor} 68%,#fff);--brand-300:color-mix(in srgb,${m.brandColor} 42%,#fff);--grad-brand:linear-gradient(120deg,${m.brandColor},var(--cyan-400) 55%,var(--mint-500));--shadow-glow-brand:0 20px 50px -18px color-mix(in srgb,${m.brandColor} 55%,transparent);}`}</style>
          <span data-brand-scope="" hidden />
        </>
      ) : null}
      {/* Rol bazlı ürün turları: sayfalar arasında gezdiği için layout'ta bir kez bağlanır (kod yalnız gerekince iner). */}
      <ProductTourLazy role={m.platformStaffFullAccess || m.impersonating ? "" : m.effectiveRole} accessible={m.accessibleModules} />
      <RealtimeRefresh tenantId={m.tenantId} />
      {/* Klavye kisayollari: komut paleti (Ctrl+K) zaten vardi ama tek
          kisayol oydu. "g" onekli iki tusluk dizi bilincli — tek harf,
          bir nota yazarken odak kaybolursa sayfayi degistirip yazilani
          kaybettirir. Detay: keyboard-shortcuts.tsx */}
      <KeyboardShortcuts />
    </ClosedModulesProvider>
  );
}

async function ShellSidebar() {
  const m = await loadShellModel();
  const office = m.office;
  return (
    <ClosedModulesProvider closed={m.closedModules}>
      <AppSidebar
        officeName={office?.name ?? "EmlakSoft Ofis"}
        plan={planLabel(office?.plan ?? "office")}
        trial={office?.status === "trial"}
        trialDaysLeft={m.trialDaysLeft}
        accessibleModules={m.accessibleModules}
        creatableModules={m.creatableModules}
        lockedHrefs={m.lockedNavHrefs}
        badges={m.navBadges}
        usage={m.planUsage}
        canUpgrade={m.accessibleModules.includes("billing") && !m.platformStaffFullAccess && (office?.plan ?? "office") !== "enterprise"}
        vitrinHref={m.vitrinHref}
        storageScope={m.storageScope}
        role={m.platformStaffFullAccess ? "owner" : m.effectiveRole}
        simple={m.uiPrefs.simple}
      />
    </ClosedModulesProvider>
  );
}

async function ShellHeader() {
  const m = await loadShellModel();
  const showNotifications = Boolean(m.userId && m.tenantId);
  return (
    <ClosedModulesProvider closed={m.closedModules}>
      {m.impersonating && m.platformStaff ? <OpsImpersonationBanner tenantName={m.impName || m.office?.name || "Ofis"} /> : null}
      {/* Demo/deneme şeridi: örnek veri varsa veya deneme sürüyorsa her sayfada, ince ve kapatılamaz (platform personeli hariç).
          Ofis verisine (örnek veri/deneme) bağlı olduğu için kabuk diliminde; üst çubukla aynı anda çizilir. */}
      {!m.platformStaffFullAccess && m.tenantId ? (
        <DemoTrialStrip sampleActive={Boolean(m.office?.sample_seeded_at)} trialDaysLeft={m.trialDaysLeft} canSwitch={!m.impersonating && canSwitchToRealUse(m.effectiveRole)} />
      ) : null}
      <header className="glass-bar sticky top-0 z-30 flex h-14 items-center justify-between gap-3 px-4 pl-16 lg:px-6">
        <AppBreadcrumb accessibleModules={m.accessibleModules} />
        <CommandSearch accessibleModules={m.accessibleModules} creatableModules={m.creatableModules} lockedHrefs={m.lockedNavHrefs} storageScope={m.storageScope} uiPrefCookie={m.uiPrefCookie} />
        <div className="ml-3 flex shrink-0 items-center gap-1.5 sm:ml-4 sm:gap-2">
          <ThemeToggle />
          {m.tenantId && !m.platformStaffFullAccess ? <Suspense fallback={null}><EfCreditBadge tenantId={m.tenantId} role={m.effectiveRole} canAccessValuation={effectiveCanAccessModule(m.effectivePerms ?? {}, "valuation")} valuationClosed={m.closedModules.includes("valuation")} impersonating={m.impersonating} /></Suspense> : null}
          {/* Hızlı eylem menüsü: en sık kullanılan kayıt akışlarına tek tıkla */}
          {m.hasQuickCreate ? <QuickCreateMenu creatableModules={m.creatableModules} lockedHrefs={m.lockedNavHrefs} /> : null}
          <Suspense fallback={<OfficeScoreLink text="Ofis skoru —" />}>
            <OfficeScoreBadge tenantId={m.userId ? m.tenantId : null} />
          </Suspense>
          {m.platformStaffFullAccess ? (
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
            initials={m.initials}
            name={m.fullName}
            subtitle={`${planLabel(m.office?.plan ?? "office")} plan`}
            links={[
              { href: "/app/hesabim", label: "Hesabım", iconName: "account" as const },
              ...(m.accessibleModules.includes("settings") ? [{ href: "/app/ayarlar", label: "Ayarlar", iconName: "settings" as const }] : []),
            ]}
            viewPrefs={m.uiPrefCookie ? { cookieName: m.uiPrefCookie, initial: m.uiPrefs } : undefined}
            fontScale={m.userId && !m.impersonating ? m.fontScale : undefined}
          />
        </div>
      </header>
    </ClosedModulesProvider>
  );
}

async function ShellTabs() {
  const m = await loadShellModel();
  return (
    <ClosedModulesProvider closed={m.closedModules}>
      <SectionTabs accessibleModules={m.accessibleModules} lockedHrefs={m.lockedNavHrefs} counts={m.tabCounts} />
    </ClosedModulesProvider>
  );
}

/** Kenar çubuğu iskeleti: gerçek `shell-aside` ile aynı genişlik (daraltılmış tercih dahil, CSS değişkeni). */
function SidebarSkeleton() {
  return (
    <aside
      aria-hidden="true"
      className="shell-aside sticky top-0 hidden h-screen shrink-0 flex-col gap-3 self-start overflow-hidden bg-[linear-gradient(180deg,#0b1220_0%,#070d19_100%)] p-4 lg:flex"
    >
      <div className="h-9 w-3/4 rounded-[var(--radius-control)] bg-white/10" />
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="h-8 w-full rounded-[var(--radius-control)] bg-white/5" />
      ))}
    </aside>
  );
}

/** Üst çubuk iskeleti: gerçek başlıkla aynı yükseklik (h-14) ve yapışkan konum (CLS yok). */
function HeaderSkeleton() {
  return (
    <header
      aria-hidden="true"
      className="glass-bar sticky top-0 z-30 flex h-14 items-center justify-between gap-3 px-4 pl-16 lg:px-6"
    >
      <Skeleton className="hidden h-4 w-40 md:block" />
      <Skeleton className="h-10 w-10 sm:w-full sm:max-w-md" />
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
    </header>
  );
}
