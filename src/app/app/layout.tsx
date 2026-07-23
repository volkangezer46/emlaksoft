import Link from "next/link";
import { LogOut, Shield } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { getPlatformStaff } from "@/lib/platform";
import { AppSidebar } from "@/components/app/app-sidebar";
import { CommandSearch } from "@/components/app/command-search";
import { NotificationBell } from "@/components/app/notification-bell";
import { cookies } from "next/headers";
import { AppPrefetcher } from "@/components/app/app-prefetcher";
import { ToastProvider } from "@/components/app/toast-provider";
import { OpsImpersonationBanner } from "@/components/app/ops-impersonation-banner";
import { LiveOfficeStrip } from "@/components/app/live-office-strip";
import { RealtimeRefresh } from "@/components/app/realtime-refresh";
import { listMyNotifications } from "@/app/actions/notifications";
import { ErrorBoundary } from "@/components/error-boundary";
import { computeOfficeScore, loadOfficeScoreInputs } from "@/lib/office-score";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveCanAccessModule, getEffectivePermissions } from "@/lib/permissions-effective";
import type { AppModule } from "@/lib/permissions";

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
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("full_name, role, tenant_id, tenants(name, plan, status)")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const tenant = profile?.tenants as
    | { name?: string; plan?: string; status?: string }
    | { name?: string; plan?: string; status?: string }[]
    | null
    | undefined;
  const office =
    (Array.isArray(tenant) ? tenant[0] : tenant) ?? undefined;
  const fullName = String(profile?.full_name ?? "ES");
  const initials = fullName
    .split(/\s+/)
    .map((part: string) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const planLabel: Record<string, string> = {
    advisor: "Danışman",
    office: "Ofis",
    professional: "Profesyonel",
    enterprise: "Kurumsal",
  };

  const platformStaff = await getPlatformStaff();

  let officeScore: number | null = null;
  let officeScoreLabel = "—";
  let notifications: Awaited<ReturnType<typeof listMyNotifications>> = [];

  if (user && profile?.tenant_id) {
    try {
      const inputs = await loadOfficeScoreInputs(supabase);
      const computed = computeOfficeScore(inputs);
      officeScore = computed.score;
      officeScoreLabel = computed.label;
    } catch {
      officeScore = null;
    }
    try {
      notifications = await listMyNotifications();
    } catch {
      notifications = [];
    }
  }

  const tenantId = (profile?.tenant_id as string | undefined) ?? null;

  const platformStaffFullAccess = platformStaff && !Boolean(user?.app_metadata?.impersonating);
  const effectivePerms = platformStaffFullAccess
    ? null
    : await getEffectivePermissions(tenantId, profile?.role ?? "advisor");
  const accessibleModules = platformStaffFullAccess
    ? NAV_MODULES
    : NAV_MODULES.filter((mod) => effectiveCanAccessModule(effectivePerms ?? {}, mod));

  const jar = await cookies();
  const impTenantId = jar.get(IMPERSONATE_COOKIE)?.value;
  const impersonating = Boolean(user?.app_metadata?.impersonating) || Boolean(impTenantId);
  let impName = jar.get("es_impersonate_name")?.value ?? "";
  if (impersonating && !impName && (impTenantId || tenantId)) {
    try {
      const admin = createAdminClient();
      const { data: t } = await admin
        .from("tenants")
        .select("name")
        .eq("id", impTenantId || tenantId!)
        .maybeSingle();
      impName = t?.name ?? "Hedef ofis";
    } catch {
      impName = "Hedef ofis";
    }
  }

  return (
    <ToastProvider>
      <ErrorBoundary>
        <div className="flex min-h-screen bg-canvas">
          <AppPrefetcher tenantId={tenantId} />
          <RealtimeRefresh tenantId={tenantId} />
        <AppSidebar
          officeName={office?.name ?? "EmlakSoft Ofis"}
          plan={planLabel[office?.plan ?? "office"] ?? "Ofis"}
          trial={office?.status === "trial"}
          officeScore={officeScore}
          accessibleModules={accessibleModules}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {impersonating && platformStaff ? <OpsImpersonationBanner tenantName={impName || office?.name || "Ofis"} /> : null}
          <header className="sticky top-0 z-30 flex h-17 items-center justify-between border-b border-line/80 bg-surface/90 px-4 pl-16 backdrop-blur-xl md:px-6">
            <CommandSearch />
            <div className="ml-4 flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-full border border-mint-500/20 bg-mint-500/10 px-3 py-1.5 text-xs font-semibold text-mint-600 lg:flex">
                <span className="status-pulse h-1.5 w-1.5 rounded-full bg-mint-500" />
                {officeScore != null ? `Ofis skoru ${officeScore} · ${officeScoreLabel}` : "Ofis skoru —"}
              </span>
              {platformStaff ? (
                <Link
                  href="/admin"
                  className="hidden items-center gap-1.5 rounded-[10px] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-700 transition hover:border-amber-400/50 lg:inline-flex"
                  title="EmlakSoft Süper Admin"
                >
                  <Shield className="h-3.5 w-3.5" /> Ops
                </Link>
              ) : null}
              <NotificationBell initial={notifications} />
              <Link href="/app/ayarlar" className="flex items-center gap-2 rounded-[11px] border border-line bg-surface p-1.5 pr-3 transition hover:border-brand-300">
                <div
                  className="grid h-8 w-8 place-items-center rounded-[9px] bg-[image:var(--grad-brand)] text-xs font-bold text-white"
                  title={profile?.full_name ?? ""}
                >
                  {initials}
                </div>
                <div className="hidden text-left xl:block">
                  <p className="max-w-28 truncate text-xs font-semibold text-ink-950">{fullName}</p>
                  <p className="text-[9px] text-text-faint">{planLabel[office?.plan ?? "office"] ?? "Ofis"} plan</p>
                </div>
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="grid h-10 w-10 place-items-center rounded-[11px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-500"
                  aria-label="Çıkış yap"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 lg:p-7">
            <LiveOfficeStrip tenantId={tenantId} />
            {children}
          </main>
        </div>
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
}
