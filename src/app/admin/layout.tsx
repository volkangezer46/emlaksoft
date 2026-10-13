import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { ConsoleMonoFont } from "@/components/ui/console/mono-font";
import { RouteSplash } from "@/components/route-splash";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { MobileMenuProvider, MobileMenuTrigger } from "@/components/app/mobile-menu-trigger";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { AdminSectionTabs } from "@/components/admin/admin-section-tabs";
import { mustChangePassword, requirePlatformStaffForAccount } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS, platformModulesFor } from "@/lib/platform-access";
import { getAdminBadges, getAdminHealth } from "@/lib/admin-badges";
import { loadStaffAvatar } from "@/lib/avatar-read";
import "@/app/console-base.css";
import "@/app/console.css";
import { SidebarBoot } from "@/components/ui/console/sidebar-boot";
import { NavPending } from "@/components/app/nav-pending";
import { ClientCacheSync } from "@/components/app/client-cache-sync";
import { ThemeController } from "@/components/theme-controller";
import { IconSprite } from "@/components/ui/icon-sprite";
import { isPlatformMfaRequired, platformMfaSyncIssue } from "@/lib/platform-mfa";
import { getPlatformMfaPolicyNow } from "@/lib/platform-security/mfa-policy";
import { getDemoPolicyNow } from "@/lib/platform-security/demo-policy";
import { createClient } from "@/lib/supabase/server";
import { DAY_MS } from "@/lib/clock";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { cookies } from "next/headers";
import { FontScaleBoot } from "@/components/font-scale-boot";
import { FONT_SCALE_COOKIE, FONT_SCALE_META_KEY, resolveFontScale } from "@/lib/font-scale";
import { UserMenuFace } from "@/components/ui/console/user-menu-face";
import { redirect } from "next/navigation";

/** Kok loading.tsx kaldirildi: kabuk sorgulari Suspense icinde, splash hemen ustunde. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleMonoFont>
      <IconSprite />
      <Suspense fallback={<RouteSplash />}>
        <AdminShell>{children}</AdminShell>
      </Suspense>
    </ConsoleMonoFont>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  // Kimlik yerel JWT'den (ağ turu yok). Personel kapısı, kendi avatar satırı (RLS: yalnız kendi satırı) ve MFA ayarı
  // birbirinden bağımsız → TEK turda paralel (eskiden staff → avatar → ayar sıralı 3 tur). Yetki kararı staff kapısındadır;
  // reddedilirse (redirect) diğer iki okuma sonucu atılır.
  const user = await getRequestUser();
  const [staff, avatar, mfaPolicy, demoPolicy] = await Promise.all([
    requirePlatformStaffForAccount(),
    user ? loadStaffAvatar(user.id) : Promise.resolve(null),
    getPlatformMfaPolicyNow(),
    getDemoPolicyNow(),
  ]);

  // Geçici parolayla açılan hesap: kendi parolasını belirleyene dek yönetim kabuğu açılmaz. Zorunlu değişim ekranı
  // kabuğun DIŞINDA ayrı rotadadır (src/app/(admin-parola)/admin/parola-yenile): parola formu her yönetim sayfasının
  // paketine girmez.
  if (mustChangePassword(user)) redirect("/admin/parola-yenile");
  const jar = await cookies();
  const fontScale = resolveFontScale({
    userId: user?.id,
    cookieValue: jar.get(FONT_SCALE_COOKIE)?.value,
    metadataValue: user?.user_metadata?.[FONT_SCALE_META_KEY],
  });

  const roleLabel = PLATFORM_ROLE_LABELS[staff.role] ?? staff.role;
  const modules = platformModulesFor(staff.role);

  // Sidebar rozet sayıları — 30 sn önbellekli (bkz. admin-badges.ts); her
  // gezinmede 3 count sorgusu koşmasın.
  const [badges, health] = await Promise.all([
    getAdminBadges(modules),
    modules.includes("sistem") ? getAdminHealth().catch(() => null) : Promise.resolve(null),
  ]);

  // MFA tek kaynak uyumu: env ile DB ayarı (SQL kapıları yalnız ayara bakar) ayrışırsa uyarı şeridi.
  const mfaSyncIssue = platformMfaSyncIssue(isPlatformMfaRequired(), mfaPolicy.dbRaw);
  const canManageSecurity = staff.role === "super_admin" && modules.includes("personel");
  const securityHref = canManageSecurity ? "/admin/personel/guvenlik" : undefined;
  // Geçiş süresi: doğrulayıcısı olmayan personele geri sayım (nextLevel aal2 = doğrulanmış faktör var; yerel okuma).
  let graceDaysLeft: number | null = null;
  if (mfaPolicy.enforced && mfaPolicy.graceActive && mfaPolicy.graceUntil) {
    const { data: aal } = await (await createClient()).auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel !== "aal2") {
      graceDaysLeft = Math.max(1, Math.ceil((new Date(mfaPolicy.graceUntil).getTime() - mfaPolicy.nowMs) / DAY_MS));
    }
  }
  const strips = [
    demoPolicy.platform ? (
      <StatusStrip key="demo" tone="danger" role="alert" href={securityHref}>
        Platform demo girişi AÇIK: giriş sayfasındaki kartla herkes tek tıkla süper admin olabilir.{" "}
        {demoPolicy.row?.until ? `Bitiş: ${STRIP_DATE.format(new Date(demoPolicy.row.until))}.` : "Süre sınırı yok (sunucu ortamı ayarı)."}
        {securityHref ? " Kapat →" : null}
      </StatusStrip>
    ) : null,
    mfaSyncIssue === "env_on_db_off" ? (
      <StatusStrip key="mfa-sync" tone="danger" role="alert" href={securityHref}>
        MFA tutarsız: sunucu ortamında PLATFORM_MFA_ENFORCEMENT açık ama &quot;platform.mfa_enforced&quot; ayarı kapalı; veritabanı personel kapıları MFA istemiyor. Güvenlik politikasından açın.
      </StatusStrip>
    ) : null,
    !mfaPolicy.enforced ? (
      <StatusStrip key="mfa-off" tone="warning" role="status" href={securityHref}>
        Personel için iki adımlı doğrulama (TOTP) zorunlu değil.{securityHref ? " Personel > Güvenlik politikası'ndan açabilirsiniz." : ""}
      </StatusStrip>
    ) : null,
    graceDaysLeft !== null && mfaPolicy.graceUntil ? (
      <StatusStrip key="mfa-grace" tone="warning" role="status" href="/admin/hesabim?sekme=guvenlik">
        İki adımlı doğrulama {STRIP_DATE.format(new Date(mfaPolicy.graceUntil))} itibarıyla zorunlu ({graceDaysLeft} gün kaldı). Hesabım &gt; Güvenlik&apos;ten doğrulayıcınızı şimdi kurun.
      </StatusStrip>
    ) : null,
  ].filter(Boolean);

  return (
    <MobileMenuProvider>
    <div className="flex min-h-screen bg-canvas">
      <ThemeController />
      <FontScaleBoot scale={fontScale} />
      <SidebarBoot />
      <NavPending />
      <ClientCacheSync identity={`admin:${staff.id}`} />
      <AdminSidebar staffName={staff.full_name} role={staff.role} roleLabel={roleLabel} badges={badges} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil hamburger: üst çubukla birlikte yapışkan, sıfır yükseklikli kapta (akışa yer kaplamaz); üst çubuğun
            pl-16 boşluğunda dikey ortalı durur (eskiden `fixed` idi, üstteki şeritlerle çakışabiliyordu). */}
        <div className="sticky top-0 z-50 h-0 md:hidden">
          <MobileMenuTrigger controlsId="admin-mobile-navigation" label="Admin menüsünü aç" variant="admin" />
        </div>
        <AdminTopbar
          roleLabel={roleLabel}
          staffName={staff.full_name}
          userFace={
            <UserMenuFace
              initials={staff.full_name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toLocaleUpperCase("tr-TR") || "P"}
              name={staff.full_name}
              subtitle={roleLabel}
              avatarUrl={avatar?.avatar_url ?? null}
              avatarPreset={avatar?.avatar_preset ?? null}
            />
          }
          modules={modules}
          fontScale={fontScale}
          health={health}
        />
        {/* grid + minmax(0,1fr): geniş tablolar kendi kaplarında kaydırılır,
            belgeyi şişirmez (iOS `overflow:clip` viewport'a propagate etmiyor). */}
        <main
          id="main-content"
          className="grid min-w-0 max-w-full flex-1 grid-cols-[minmax(0,1600px)] content-start justify-center gap-4 overflow-x-clip p-4 pb-24 md:px-5 md:pt-5 lg:px-6 lg:pb-6 lg:pt-5"
        >
          {strips.length > 0 ? <div className="space-y-2">{strips}</div> : null}
          <AdminSectionTabs modules={modules} />
          {children}
        </main>
      </div>
    </div>
    </MobileMenuProvider>
  );
}

const STRIP_DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });

/**
 * Kabuk bilgi şeridi (tam genişlik, yuvarlak kart): ton token'lı (`.tone-warning` / `.tone-danger`,
 * açık + koyu temada AA). Bağlantı verilirse tüm şerit ilgili ayara gider (sağda ok).
 */
function StatusStrip({
  tone,
  role,
  href,
  children,
}: {
  tone: "warning" | "danger";
  role: "status" | "alert";
  href?: string;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {href ? <ChevronRight className="h-4 w-4 shrink-0 opacity-70" aria-hidden /> : null}
    </>
  );
  const cls = `tone-${tone} flex items-center gap-2.5 rounded-[var(--radius-control)] px-3.5 py-1.5 text-xs font-medium leading-5`;
  return href ? (
    <Link href={href} role={role} className={`${cls} focus-ring transition-[filter] hover:brightness-[0.98]`}>
      {body}
    </Link>
  ) : (
    <p role={role} className={cls}>
      {body}
    </p>
  );
}
