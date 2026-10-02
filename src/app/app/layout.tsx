import { Suspense } from "react";
import Link from "next/link";
import { Building2, CalendarDays, ListChecks, LogOut, Phone, Plus, Shield, UserPlus } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
        .select("name, plan, status, brand_color, created_at")
        .eq("id", claimedTenantId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  // profile ve platformStaff ikisi de yalnız `user`'a bağlı, birbirine değil →
  // her navigasyonda seri iki round-trip yerine paralel (bootstrap hızlanır).
  const [{ data: profile }, platformStaff, { data: impersonatedTenant }] = await Promise.all([
    user
      ? supabase
          .from("profiles")
          .select("full_name, role, tenant_id, tenants(name, plan, status, brand_color, created_at)")
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
  const effectiveRole = impersonating ? "readonly" : (profile?.role ?? "advisor");
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

  // Etkin izinler yalnız profilden gelen tenant/rol'e bağlı: skor ile aynı anda
  // başlat (önceden skor+bildirim beklendikten SONRA seri çalışıyordu).
  const effectivePermsPromise = platformStaffFullAccess
    ? Promise.resolve(null)
    : impersonating
      ? Promise.resolve(immutableReadonlyPermissions())
      : getEffectivePermissions(tenantId, effectiveRole, user?.id);
  // Skor (navigasyonlar arası cache'li, 3 dk; anahtar tenantId içerir). Kenar çubuğu
  // sayıyı prop olarak aldığı için bloklayıcı kalır ama izinlerle paralel.
  const scorePromise =
    user && tenantId ? getOfficeScoreCached(tenantId).catch(() => null) : Promise.resolve(null);
  const [effectivePerms, scoreComputed] = await Promise.all([effectivePermsPromise, scorePromise]);
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
  const canCreateCustomer = canCreate("customers");
  const canCreateProperty = canCreate("properties");
  const canCreateCall = canCreate("calls");
  const canCreateAppointment = canCreate("appointments");
  const canCreateTask = canCreate("tasks");
  const hasQuickCreate =
    canCreateCustomer || canCreateProperty || canCreateCall || canCreateAppointment || canCreateTask;

  const jar = await cookies();
  const impersonationCookieMatches = jar.get(IMPERSONATE_COOKIE)?.value === tenantId;
  const impName = impersonationCookieMatches
    ? (jar.get("es_impersonate_name")?.value ?? office?.name ?? "Hedef ofis")
    : (office?.name ?? "Hedef ofis");

  return (
    <ToastProvider>
      <ThemeController />
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
          officeScore={officeScore}
          accessibleModules={accessibleModules}
          lockedHrefs={lockedNavHrefs}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {impersonating && platformStaff ? <OpsImpersonationBanner tenantName={impName || office?.name || "Ofis"} /> : null}
          <header className="sticky top-0 z-30 flex h-17 items-center justify-between border-b border-line/80 bg-surface/90 px-4 pl-16 backdrop-blur-xl lg:px-6">
            <CommandSearch accessibleModules={accessibleModules} storageScope={user && tenantId ? `${tenantId}:${user.id}` : undefined} />
            <div className="ml-3 flex shrink-0 items-center gap-1.5 sm:ml-4 sm:gap-2">
              <ThemeToggle />
              {/* Hızlı eylem menüsü: en sık kullanılan kayıt akışlarına tek tıkla */}
              {hasQuickCreate ? <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="focus-ring press inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 text-xs font-bold text-white transition hover:bg-brand-700"
                    aria-label="Hızlı yeni kayıt menüsü"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline">Yeni</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-52">
                  {canCreateCustomer ? <DropdownMenuItem asChild>
                    <Link href="/app/musteriler/yeni">
                      <UserPlus /> Yeni müşteri
                    </Link>
                  </DropdownMenuItem> : null}
                  {canCreateProperty ? <DropdownMenuItem asChild>
                    <Link href="/app/portfoyler/yeni">
                      <Building2 /> Yeni portföy
                    </Link>
                  </DropdownMenuItem> : null}
                  {canCreateCall ? <DropdownMenuItem asChild>
                    <Link href="/app/arama">
                      <Phone /> Görüşme kaydet
                    </Link>
                  </DropdownMenuItem> : null}
                  {canCreateAppointment ? <DropdownMenuItem asChild>
                    <Link href="/app/randevular/yeni">
                      <CalendarDays /> Randevu
                    </Link>
                  </DropdownMenuItem> : null}
                  {canCreateTask ? <DropdownMenuItem asChild>
                    <Link href="/app/gorevler/yeni">
                      <ListChecks /> Görev
                    </Link>
                  </DropdownMenuItem> : null}
                </DropdownMenuContent>
              </DropdownMenu> : null}
              <Link
                href="/app/raporlar"
                title="Kural tabanlı ofis skoru (yapay zekâ değil): açık talepler, canlı portal ilanları, son 7 günün randevu ve aramaları ile son 30 günün kapanışları puan ekler; gecikmiş portal teyitleri puan düşürür. Başlangıç 42. Rapor merkezini açmak için tıklayın."
                className="focus-ring hidden items-center gap-2 rounded-full border border-mint-500/20 bg-mint-500/10 px-3 py-1.5 text-xs font-semibold text-mint-600 transition hover:border-mint-500/45 hover:bg-mint-500/15 lg:flex"
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
              <Link href="/app/ayarlar" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-1.5 sm:pr-3 transition hover:border-brand-300">
                <div
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] bg-[image:var(--grad-brand)] text-xs font-bold text-white"
                  title={profile?.full_name ?? ""}
                >
                  {initials}
                </div>
                <div className="hidden text-left xl:block">
                  <p className="max-w-28 truncate text-xs font-semibold text-ink-950">{fullName}</p>
                  <p className="text-xs text-text-faint">{planLabel(office?.plan ?? "office")} plan</p>
                </div>
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-500"
                  aria-label="Çıkış yap"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
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
            <SectionTabs accessibleModules={accessibleModules} lockedHrefs={lockedNavHrefs} />
            {children}
          </main>
        </div>
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
}
