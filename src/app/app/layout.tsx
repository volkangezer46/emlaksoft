import { Suspense, cache } from "react";
import Link from "@/components/ui/smart-link";
import { Shield } from "lucide-react";
import "@/app/console-base.css";
import "@/app/console.css";
import { ConsoleMonoFont } from "@/components/ui/console/mono-font";
import { SidebarBoot } from "@/components/ui/console/sidebar-boot";
import { StreamRevealBoot } from "@/components/app/stream-reveal-boot";
import { NavPending } from "@/components/app/nav-pending";
import { ClientCacheSync } from "@/components/app/client-cache-sync";
import { UserMenu } from "@/components/ui/console/user-menu";
import { UserMenuFace } from "@/components/ui/console/user-menu-face";
import { AppBreadcrumb } from "@/components/app/app-breadcrumb";
import { QuickCreateMenu } from "@/components/app/quick-create-menu";
import { filterNavBadgesByAccess, getNavBadges, getPlanUsage, tabCountsFromUsage } from "@/lib/nav-badges";
import { DAY_MS, msUntil } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { loadOwnProfileAvatar } from "@/lib/avatar-read";
import { getPlatformStaffIdentity, isPlatformAllowlistedEmail } from "@/lib/platform";
import { AppSidebar } from "@/components/app/app-sidebar";
import { MobileMenuProvider, MobileMenuTrigger } from "@/components/app/mobile-menu-trigger";
import { CommandSearch } from "@/components/app/command-search";
import { NotificationBell } from "@/components/app/notification-bell";
import { EfCreditBadge } from "@/components/app/ef-credit-badge";
import { ThemeController } from "@/components/theme-controller";
import { IconSprite } from "@/components/ui/icon-sprite";
import { ThemeToggle } from "@/components/theme-toggle";
import { cookies } from "next/headers";
import { SCOPE_COOKIE } from "@/lib/ui/scope";
import { ProductTourLazy } from "./product-tour-lazy";
import { ToastProvider } from "@/components/app/toast-provider";
import { EmailVerifyStrip } from "@/components/app/email-verify-strip";
import { PlatformBannerSlot, WhatsNewSlot } from "@/components/app/office-broadcast-slots";
import { loadOfficeBroadcastState } from "@/lib/platform-announcements/office";
import { NpsPromptSlot } from "@/components/app/nps-prompt-slot";
import { LegalReconsentGate } from "@/components/app/legal-reconsent-gate";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { isDemoEmail } from "@/lib/demo-credentials";
import { OpsImpersonationBanner } from "@/components/app/ops-impersonation-banner";
import { DemoTrialStrip } from "@/components/app/demo-trial-strip";
import { canSwitchToRealUse } from "@/lib/sample-data/real-use";
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
  mergeEffectivePermissions,
} from "@/lib/permissions-effective";
import { loadShellBootstrap, shellRpcKnownMissing } from "@/lib/app-shell/bootstrap";
import { navBadgesFromCounts, usageRowsFromCounts } from "@/lib/app-shell/bootstrap-core";
import { resolveModuleState } from "@/lib/modules/logic";
import type { AppModule } from "@/lib/permissions";
import { planLabelIn } from "@/lib/billing/plans";
import { lockedHrefs } from "@/lib/billing/page-gates";
import { getCatalogForPlan, getPlanTier } from "@/lib/billing/plan-definitions";
import { getAppActions } from "@/lib/palette-core";
import { ICONS } from "@/lib/icons";
import { buildShellActions, buildShellNavSet, buildShortcuts, shellIcon } from "@/lib/nav-shell-server";
import { ClosedModulesProvider } from "@/components/app/closed-modules-context";
import { getClosedFeatures } from "@/lib/modules/state";
import { getUserHiddenModules } from "@/lib/modules/prefs";
import { isFeatureKey, mergeHidden } from "@/lib/modules/registry";
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
  "prospecting",
];

/**
 * Menü kataloğu, rol düzenleri, ikon sözlüğü ve palet eylemleri SUNUCUDA çözülür; istemci kabuğu (yan menü, kırıntı,
 * sekme şeridi, kısayollar) yalnız düz veri alır (src/lib/nav-shell.ts). Sabit kısımlar modül düzeyinde bir kez hesaplanır.
 */
const SHORTCUTS = buildShortcuts();
const SIDEBAR_ICONS = { portal: shellIcon(ICONS.portal), tools: shellIcon(ICONS.baslikArac), modules: shellIcon(ICONS.moduller) };

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

type UserMenuShellProps = Omit<React.ComponentProps<typeof UserMenu>, "face"> & { initials: string };

/** Kullanıcı menüsü; düğme yüzü (avatar/hazır avatar/baş harf) SUNUCUDA çizilir (avatar çizimleri istemci paketine girmez). */
function UserMenuShell({ initials, avatarUrl = null, avatarPreset = null, ...props }: UserMenuShellProps & { avatarUrl?: string | null; avatarPreset?: string | null }) {
  return (
    <UserMenu
      {...props}
      face={<UserMenuFace initials={initials} name={props.name} subtitle={props.subtitle} avatarUrl={avatarUrl} avatarPreset={avatarPreset} />}
    />
  );
}

/** Profil avatarı (tek PK sorgusu) ve ofis skoru (3 dk önbellekli; ilk hesap 5 sorgu): istek-içi TEK çağrı. */
const avatarFor = cache((userId: string) => loadOwnProfileAvatar(userId).catch(() => null));
const officeScoreFor = cache((tenantId: string) => getOfficeScoreCached(tenantId).catch(() => null));

/**
 * Kabuk verisinin TAMAMI layout girişinde, birbirini beklemeden başlar: kabuk modeli (tek RPC), duyuru/yenilikler RPC'si,
 * avatar ve ofis skoru. Kimlik yerel JWT'den (getRequestUser, istek-içi önbellekli) gelir; ofis skoru talep edilen
 * kiracıyla ısıtılır (impersonation'da claim zaten hedef ofistir). Böylece kabuk dilimleri modelden SONRA ikinci bir tur
 * beklemez; Suspense'li yuvalar ilk akış paketinde çoğunlukla hazırdır (ayrı akış/gösterim turu yok).
 */
function preloadShell(): void {
  void loadShellModel().catch(() => undefined);
  void loadOfficeBroadcastState();
  void getRequestUser()
    .then((user) => {
      if (!user) return;
      if (user.app_metadata?.impersonating !== true) void avatarFor(user.id);
      const claimed = typeof user.app_metadata?.tenant_id === "string" ? user.app_metadata.tenant_id.trim() : "";
      if (claimed) void officeScoreFor(claimed);
    })
    .catch(() => undefined);
}

/** Kullanıcı menüsü + profil avatarı: avatar modelle AYNI anda başlar (preloadShell), kabuk akışını ayrıca bekletmez. */
async function UserMenuWithAvatar({ userId, ...props }: { userId: string | null } & UserMenuShellProps) {
  const avatar = userId ? await avatarFor(userId) : null;
  return <UserMenuShell {...props} avatarUrl={avatar?.avatar_url ?? null} avatarPreset={avatar?.avatar_preset ?? null} />;
}

/** Ofis skoru rozeti: ilk hesap 5 sorgu olabildiği için kendi sınırında akar (modelle aynı anda ısıtılır). */
async function OfficeScoreBadge({ tenantId }: { tenantId: string | null }) {
  const score = tenantId ? await officeScoreFor(tenantId) : null;
  return <OfficeScoreLink text={score ? `Ofis skoru ${score.score}` : "Ofis skoru —"} label={score ? `Ofis skoru ${score.score}, ${score.label}` : "Ofis skoru hesaplanıyor"} />;
}

/** Üst çubukta kompakt skor hapı (kısa metin; tam ad ve seviye erişilebilir adda ve ipucunda). */
function OfficeScoreLink({ text, label = "Ofis skoru" }: { text: string; label?: string }) {
  return (
    <Link
      href="/app/raporlar"
      aria-label={`${label}. Rapor merkezini aç`}
      title="Kural tabanlı ofis skoru (yapay zekâ değil): açık talepler, canlı portal ilanları, son 7 günün randevu ve aramaları ile son 30 günün kapanışları puan ekler; gecikmiş portal teyitleri puan düşürür. Başlangıç 42. Rapor merkezini açmak için tıklayın."
      className="focus-ring hidden h-8 items-center gap-1.5 rounded-full border border-mint-500/20 bg-mint-500/10 px-2.5 text-xs font-semibold text-mint-600 transition hover:border-mint-500/45 hover:bg-mint-500/15 xl:flex touch:min-h-11"
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
  // Platform personeli: kabuk RPC'si 'platform_staff' alanını döndürüyorsa ve çağıran aktif personel DEĞİLSE
  // (allowlist e-postası hariç: ilk girişte satır oluşturma yolu korunur) ayrı platform_staff turu atılmaz.
  // Karar her istekte DB'den (RPC, RLS) gelir; başlık/çerezle verilmez. Personel ise AAL2/parola kapılı tam yol çalışır.
  const platformStaffPromise = bootPromise.then((b) =>
    b && b.platformStaff === null && !isPlatformAllowlistedEmail(user?.email) ? null : getPlatformStaffIdentity(),
  );
  const [boot, platformStaff, { data: impersonatedTenant }, identityRes] = await Promise.all([
    bootPromise,
    platformStaffPromise,
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
  // Adminden eklenen pakette limit ve ad katalogdan (taban kimlikte okunmaz: undefined, kod tanımı).
  const planCatalogPromise = getCatalogForPlan(office?.plan);
  // Plan kullanım kartı (gerçek sayım) yalnız tenant+plana bağlı: RPC'den ya da head-count sorgularından.
  const usagePromise =
    user && tenantId && !platformStaffFullAccess
      ? bootUsable && boot
        ? planCatalogPromise.then((catalog) => usageRowsFromCounts(office?.plan, boot.usage, catalog))
        : planCatalogPromise.then((catalog) => getPlanUsage(supabase, tenantId, office?.plan, catalog)).catch(() => [])
      : Promise.resolve([]);
  // Ofisin kapattığı modüller (menü, sekme, palet ve hızlı oluşturmadan çıkar). Platform personeli etkilenmez.
  const closedModulesPromise: Promise<string[]> =
    tenantId && !platformStaffFullAccess
      ? bootUsable && boot
        ? Promise.resolve(resolveModuleState(boot.modules).closed)
        : getClosedFeatures(tenantId).catch(() => [])
      : Promise.resolve([]);
  // Kişisel gizleme (user_module_prefs): yalnız görünürlük; ofis kapalılarıyla birleşir.
  // Kabuk RPC `hidden_modules` alanını döndürüyorsa ayrı tur atılmaz; alan yoksa (migration yok) eski okuma.
  const hiddenModulesPromise: Promise<string[]> =
    tenantId && user && !impersonating && !platformStaffFullAccess
      ? bootUsable && boot?.hiddenModules
        ? Promise.resolve(boot.hiddenModules.filter(isFeatureKey))
        : getUserHiddenModules(user.id, tenantId)
      : Promise.resolve([]);
  const [effectivePerms, planUsage, specBadges, officeClosedModules, hiddenModules, jar] = await Promise.all([
    effectivePermsPromise,
    usagePromise,
    speculationValid && specBadgesPromise ? specBadgesPromise : Promise.resolve(null),
    closedModulesPromise,
    hiddenModulesPromise,
    cookies(),
  ]);
  const closedModules = mergeHidden(officeClosedModules, hiddenModules);
  // Paket kilidi: menüde kilit simgesi gösterilecek sayfalar (platform personeli hariç)
  const lockedNavHrefs = platformStaffFullAccess
    ? []
    : lockedHrefs({ plan: office?.plan, tier: await getPlanTier(office?.plan), trial: office?.status === "trial", tenantCreatedAt: office?.created_at });
  const accessibleModules = platformStaffFullAccess
    ? NAV_MODULES
    : NAV_MODULES.filter((mod) => effectiveCanAccessModule(effectivePerms ?? {}, mod));
  const canCreate = (mod: AppModule) =>
    platformStaffFullAccess || effectiveHasPermission(effectivePerms ?? {}, mod, "create");
  // Hızlı oluştur + komut paleti "Eylemler": yalnız "create" yetkili modüller.
  const creatableModules = NAV_MODULES.filter((mod) => accessibleModules.includes(mod) && canCreate(mod));
  const hasQuickCreate = getAppActions(creatableModules, "", lockedNavHrefs, closedModules).length > 0;
  // Menü düzenleri + hızlı eylemler (düz veri; yan menü, kırıntı ve sekme şeridi AYNI nesneyi paylaşır).
  const navRole = platformStaffFullAccess ? "owner" : effectiveRole;
  const navs = buildShellNavSet({ accessible: accessibleModules, closed: closedModules, role: navRole });
  const shellActions = buildShellActions(creatableModules, lockedNavHrefs, closedModules);
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
    navRole,
    navs,
    shellActions,
    lockedNavHrefs,
    closedModules,
    navBadges,
    planUsage,
    planName: planLabelIn(office?.plan ?? "office", await planCatalogPromise),
    tabCounts,
    vitrinHref,
    uiPrefCookie,
    uiPrefs,
    scopeCookie: jar.get(SCOPE_COOKIE)?.value ?? null,
    fontScale,
    impName,
    emailUnverified: Boolean(user) && !impersonating && !isEmailVerified(user),
    demoEmail: isDemoEmail(user?.email),
    trialDaysLeft,
    storageScope: user && tenantId ? `${tenantId}:${user.id}` : undefined,
  };
}

/**
 * Kabuk (yan menü, üst çubuk, sekme şeridi, görünmez kabuk parçaları) Suspense DIŞINDA çizilir: ilk HTML paketi gerçek
 * menü ve başlık METNİYLE gelir (eskiden ilk boyama yalnız gri iskeletti). Layout senkron kalır; kabuk dilimleri ve sayfa
 * (`children`) Flight'ta YAN YANA çözülür (sayfa sorguları kabuk modelini beklemez), HTML'in ilk paketi kabuk verisini
 * (tek RPC + paralel duyuru/avatar turu, `preloadShell`) bekler. Sayfa kendi loading.tsx sınırında akar.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  preloadShell();
  return (
    <ConsoleMonoFont>
    <ToastProvider>
      {/* Akışlı içerik geldiği karede açılır (React'in 300 ms gösterim kısıtı panelde kapalı; B021). */}
      <StreamRevealBoot />
      <IconSprite />
      <ThemeController />
      <SidebarBoot />
      <NavPending />
      <ErrorBoundary>
        <MobileMenuProvider>
        {/* iOS PWA (viewportFit cover + black-translucent): durum çubuğu (çentik) bandı koyu zeminle örtülür, kabuk bandın
            ALTINDAN başlar; üst çubuk bu banda yapışır (B135). Masaüstünde env() = 0: bant da dolgu da yoktur. */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] bg-[var(--navy-900)]" />
        <div className="app-frame flex min-h-screen bg-canvas pt-[env(safe-area-inset-top)]">
          <ShellBoot />
          <ShellSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <ShellHeader />
            {/* grid + minmax(0,1fr): her doğrudan çocuk (SectionTabs + sayfa)
                tam olarak kullanılabilir genişliğe sabitlenir; içteki geniş tablonun
                overflow-x-auto kabı düzgün kaydırılır ve belgeyi (ICB'yi) şişiremez.
                iOS Safari `overflow:clip`'i viewport'a propagate etmiyor (sayfa yana
                kayıyordu) — minmax(0,…) track bunu kökten keser. İçerik en çok 1600 px ve ortalı
                (geniş ekranda satırlar okunur kalır; liste/tablo bu sınır içinde tam genişlik). Yatayda çentik payı (safe-area). */}
            <main
              id="main-content"
              className="grid min-w-0 max-w-full flex-1 grid-cols-[minmax(0,1600px)] content-start justify-center overflow-x-clip pb-28 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 md:pl-[max(1.25rem,env(safe-area-inset-left))] md:pr-[max(1.25rem,env(safe-area-inset-right))] md:pt-5 lg:pb-6 lg:pl-[max(1.5rem,env(safe-area-inset-left))] lg:pr-[max(1.5rem,env(safe-area-inset-right))] lg:pt-5"
            >
              <ShellTabs />
              {/* Sayfa içi sekme alanları (InlineTabbedPanel) buraya yerleşir: popup değil, akışta. */}
              <div id="inline-panel-host" className="min-w-0" />
              {children}
            </main>
          </div>
        </div>
        </MobileMenuProvider>
      </ErrorBoundary>
    </ToastProvider>
    </ConsoleMonoFont>
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
      <ClientCacheSync identity={`app:${m.userId ?? "-"}:${m.tenantId ?? "-"}:${m.impersonating ? "imp" : "std"}`} />
      {/* Klavye kisayollari: komut paleti (Ctrl+K) zaten vardi ama tek
          kisayol oydu. "g" onekli iki tusluk dizi bilincli — tek harf,
          bir nota yazarken odak kaybolursa sayfayi degistirip yazilani
          kaybettirir. Detay: keyboard-shortcuts.tsx */}
      <KeyboardShortcuts go={SHORTCUTS.go} create={SHORTCUTS.create} />
      {/* Yeniden onay kapısı (AD12) + ürün içi NPS (DG8): ikisi de görünmez ya da örtü; TEK sınırda akar, kabuğu bekletmez
          (önbellekli liste boşsa ek DB turu yok; sorulacak anket yoksa hiçbir şey çizilmez, kod tembel iner). */}
      {m.userId && !m.impersonating && !m.platformStaffFullAccess ? (
        <Suspense fallback={null}>
          <LegalReconsentGate userId={m.userId} />
          {m.tenantId ? <NpsPromptSlot tenantId={m.tenantId} userId={m.userId} role={m.effectiveRole} plan={m.office?.plan ?? null} /> : null}
        </Suspense>
      ) : null}
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
        plan={m.planName}
        trial={office?.status === "trial"}
        trialDaysLeft={m.trialDaysLeft}
        navs={m.navs}
        actions={m.shellActions}
        icons={SIDEBAR_ICONS}
        lockedHrefs={m.lockedNavHrefs}
        badges={m.navBadges}
        usage={m.planUsage}
        canUpgrade={m.accessibleModules.includes("billing") && !m.platformStaffFullAccess && (office?.plan ?? "office") !== "enterprise"}
        vitrinHref={m.vitrinHref}
        storageScope={m.storageScope}
        role={m.navRole}
        simple={m.uiPrefs.simple}
        scopeCookie={m.scopeCookie}
      />
    </ClosedModulesProvider>
  );
}

async function ShellHeader() {
  const m = await loadShellModel();
  const showNotifications = Boolean(m.userId && m.tenantId);
  const userMenuProps = {
    initials: m.initials,
    name: m.fullName,
    subtitle: `${m.planName} plan`,
    links: [
      { href: "/app/hesabim", label: "Hesabım", iconName: "account" as const },
      ...(m.accessibleModules.includes("settings") ? [{ href: "/app/ayarlar", label: "Ayarlar", iconName: "settings" as const }] : []),
    ],
    viewPrefs: m.uiPrefCookie ? { cookieName: m.uiPrefCookie, initial: m.uiPrefs } : undefined,
    fontScale: m.userId && !m.impersonating ? m.fontScale : undefined,
  };
  return (
    <ClosedModulesProvider closed={m.closedModules}>
      {m.impersonating && m.platformStaff ? <OpsImpersonationBanner tenantName={m.impName || m.office?.name || "Ofis"} /> : null}
      {/* Demo/deneme şeridi: örnek veri varsa veya deneme sürüyorsa her sayfada, ince ve kapatılamaz (platform personeli hariç).
          Ofis verisine (örnek veri/deneme) bağlı olduğu için kabuk diliminde; üst çubukla aynı anda çizilir. */}
      {!m.platformStaffFullAccess && m.tenantId ? (
        <DemoTrialStrip sampleActive={Boolean(m.office?.sample_seeded_at)} trialDaysLeft={m.trialDaysLeft} canSwitch={!m.impersonating && canSwitchToRealUse(m.effectiveRole)} />
      ) : null}
      {/* Demo kişilikleri (demo-credentials alan adı) doğrulama e-postası alamaz: şerit onlara gösterilmez. */}
      {m.emailUnverified && !m.demoEmail && !m.platformStaffFullAccess && m.tenantId ? <EmailVerifyStrip /> : null}
      {/* Platform duyuru banner'ı (AD8): hedef ofis + tarih aralığı RLS'te süzülür. Duyuru RPC'si modelle AYNI anda başlar
          (preloadShell); banner kabukla birlikte çizilir → sonradan belirip sayfayı aşağı itmez (CLS yok). */}
      {m.tenantId && !m.platformStaffFullAccess ? <PlatformBannerSlot /> : null}
      {/* Üst çubuk `sticky` = konumlandırılmış kap: hamburger (yalnız lg altı) mutlak konumla sol boşluğa oturur,
          üstteki şeritlerle (demo/deneme, e-posta doğrulama) çakışmaz. Çentik bandının ALTINA yapışır; yatayda safe-area. */}
      <header className="glass-bar sticky top-[env(safe-area-inset-top)] z-30 flex h-14 items-center justify-between gap-3 pl-[max(4rem,calc(env(safe-area-inset-left)+3.25rem))] pr-[max(1rem,env(safe-area-inset-right))] lg:pl-[max(1.5rem,env(safe-area-inset-left))] lg:pr-[max(1.5rem,env(safe-area-inset-right))]">
        <MobileMenuTrigger controlsId="app-mobile-navigation" label="Panel menüsünü aç" />
        {/* Kırıntı yalnız xl ve üstünde: 1024 px'te arama kutusu daralıp sağdaki düğme grubunun üstüne biniyordu (B144). */}
        <div className="contents max-xl:hidden">
          <AppBreadcrumb navs={m.navs} role={m.navRole} scopeCookie={m.scopeCookie} />
        </div>
        <CommandSearch accessibleModules={m.accessibleModules} creatableModules={m.creatableModules} lockedHrefs={m.lockedNavHrefs} storageScope={m.storageScope} uiPrefCookie={m.uiPrefCookie} />
        {/* Sağ grup arama kutusunun ÜSTÜNDE (z-10): dar ekranda çakışsa bile tema/zil/menü tıklaması kendi düğmesine düşer. */}
        <div className="relative z-10 ml-3 flex shrink-0 items-center gap-1.5 sm:ml-4 sm:gap-2">
          <ThemeToggle />
          {/* Yenilikler (AD8): rozet sayısı aynı tek RPC'den (modelle paralel); düğme kabukla birlikte çizilir. */}
          {m.tenantId && !m.platformStaffFullAccess ? <WhatsNewSlot /> : null}
          {/* Hızlı eylem menüsü: en sık kayıt akışlarına tek tıkla. Mobilde "+ Yeni" alt çubukta olduğundan üst çubuktaki
              kopya yalnız lg ve üstünde (flex sarmalayıcı satır kutusu payı eklemez; masaüstü aynı). */}
          {m.hasQuickCreate ? (
            <div className="hidden lg:flex">
              <QuickCreateMenu creatableModules={m.creatableModules} lockedHrefs={m.lockedNavHrefs} />
            </div>
          ) : null}
          {/* Analiz bakiyesi + ofis skoru TEK sınırda akar (kabuğu bekletmez; ofis skorunun ilk hesabı 5 sorgu olabilir). */}
          <Suspense fallback={<OfficeScoreLink text="Ofis skoru —" />}>
            {m.tenantId && !m.platformStaffFullAccess ? (
              <EfCreditBadge
                tenantId={m.tenantId}
                role={m.effectiveRole}
                canAccessValuation={effectiveCanAccessModule(m.effectivePerms ?? {}, "valuation")}
                valuationClosed={m.closedModules.includes("valuation")}
                impersonating={m.impersonating}
              />
            ) : null}
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
          {/* Avatar modelle aynı anda okunur (preloadShell, tek PK sorgusu): menü kabukla birlikte, avatarıyla çizilir. */}
          <UserMenuWithAvatar userId={m.userId && !m.impersonating ? m.userId : null} {...userMenuProps} />
        </div>
      </header>
    </ClosedModulesProvider>
  );
}

async function ShellTabs() {
  const m = await loadShellModel();
  return (
    <ClosedModulesProvider closed={m.closedModules}>
      <SectionTabs navs={m.navs} scopeCookie={m.scopeCookie} role={m.navRole} lockedHrefs={m.lockedNavHrefs} counts={m.tabCounts} />
    </ClosedModulesProvider>
  );
}
