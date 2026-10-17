import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { ConsoleMonoFont } from "@/components/ui/console/mono-font";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { MobileMenuProvider, MobileMenuTrigger } from "@/components/app/mobile-menu-trigger";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { AdminSectionTabs, AdminSectionTabsPlaceholder } from "@/components/admin/admin-section-tabs";
import { AdminRealtime } from "@/components/admin/admin-realtime";
import { mustChangePassword, requirePlatformStaffForAccount } from "@/lib/platform";
import { platformModulesFor, platformRoleLabel } from "@/lib/platform-access";
import { getAdminBadges, getAdminHealth, type AdminBadges } from "@/lib/admin-badges";
import { getPlanSupport } from "@/lib/billing/plan-support";
import { loadStaffAvatar } from "@/lib/avatar-read";
import { loadMenuOverrides } from "@/lib/nav-overrides-read";
import { adminNavCatalog } from "@/lib/admin/nav-client-catalog";
import "@/app/console-base.css";
import "@/app/console.css";
import "@/app/console-premium.css";
import "@/app/console-shell.css";
import { SidebarBoot } from "@/components/ui/console/sidebar-boot";
import { NavPending } from "@/components/app/nav-pending";
import { ClientCacheSync } from "@/components/app/client-cache-sync";
import { ThemeController } from "@/components/theme-controller";
import { IconSprite } from "@/components/ui/icon-sprite";
import { ToastProvider } from "@/components/app/toast-provider";
import { Skeleton } from "@/components/ui/skeleton";
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

/**
 * Admin kabuğu (B022): çerçeve İLK BAYTTA gider, tam ekran açılış ekranı YOK. Eskiden tüm kabuk tek
 * `<Suspense fallback={RouteSplash}>` içindeydi: kabuk sorguları bitene kadar (~300 ms) yalnız "E" ekranı görünüyordu ve
 * sayfa sorguları kabuktan SONRA başlıyordu. Şimdi kabuk dilimleri (yan menü, üst çubuk, şeritler, sekme şeridi)
 * kendi küçük Suspense sınırlarında, gerçek boyutlu iskeletle akar; sayfa (`children`) kabuğu BEKLEMEZ, kendi
 * loading.tsx'iyle paralel akar (her sayfa kendi personel/modül kapısını çağırır). Personel kimliği istek içinde
 * önbelleklidir (React cache): dilimler aynı okumayı paylaşır. Rozet sayıları ve sistem sağlığı söz (promise) olarak
 * istemciye verilir; rozet/çip küçük sınırlarda gelir, yan menü ve üst çubuk onları beklemez.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleMonoFont>
      <ToastProvider>
        <IconSprite />
        <ThemeController />
        <SidebarBoot />
        <NavPending />
        <MobileMenuProvider>
          <div className="flex min-h-screen bg-canvas">
            <Suspense fallback={null}>
              <ShellBoot />
            </Suspense>
            <Suspense fallback={<AdminSidebarSkeleton />}>
              <ShellSidebar />
            </Suspense>
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Mobil hamburger: üst çubukla birlikte yapışkan, sıfır yükseklikli kapta (akışa yer kaplamaz); üst çubuğun
                  sol boşluğunda dikey ortalı durur. iOS PWA (B135): durum çubuğu (safe-area üst) kadar aşağı, yatayda çentik
                  kadar sağa kayar (`left-3` düğmenin sol kenarı en az safe-area-inset-left olur). */}
              <div className="sticky top-0 z-50 h-0 [transform:translate(max(0px,calc(env(safe-area-inset-left)-0.75rem)),env(safe-area-inset-top))] md:hidden">
                <MobileMenuTrigger controlsId="admin-mobile-navigation" label="Admin menüsünü aç" variant="admin" />
              </div>
              <Suspense fallback={<AdminTopbarSkeleton />}>
                <ShellTopbar />
              </Suspense>
              {/* grid + minmax(0,1fr): geniş tablolar kendi kaplarında kaydırılır,
                  belgeyi şişirmez (iOS `overflow:clip` viewport'a propagate etmiyor). */}
              <main
                id="main-content"
                className="grid min-w-0 max-w-full flex-1 grid-cols-[minmax(0,1600px)] content-start justify-center gap-4 overflow-x-clip p-4 pb-24 md:px-5 md:pt-5 lg:px-6 lg:pb-6 lg:pt-5"
              >
                <Suspense fallback={null}>
                  <ShellStrips />
                </Suspense>
                <Suspense fallback={<Suspense fallback={null}><AdminSectionTabsPlaceholder catalog={adminNavCatalog()} /></Suspense>}>
                  <ShellTabs />
                </Suspense>
                {children}
              </main>
            </div>
          </div>
        </MobileMenuProvider>
      </ToastProvider>
    </ConsoleMonoFont>
  );
}

/** Kabuk kimliği: personel (yerel JWT + önbellekli personel satırı), rol etiketi ve modüller. İstek içinde tek okuma. */
async function shellIdentity() {
  const user = await getRequestUser();
  const staff = await requirePlatformStaffForAccount();
  return { user, staff, roleLabel: platformRoleLabel(staff), modules: platformModulesFor(staff) };
}

/**
 * Görünmez kabuk parçaları: zorunlu parola yönlendirmesi, yazı boyutu, istemci önbellek tazeliği ve canlı veri adacığı.
 * Geçici parolayla açılan hesap: kendi parolasını belirleyene dek yönetim kabuğu açılmaz. Zorunlu değişim ekranı kabuğun
 * DIŞINDA ayrı rotadadır (src/app/(admin-parola)/admin/parola-yenile); sayfalar da kendi kapısında (`requirePlatformStaff`)
 * aynı hesabı /admin/hesabim'e yollar.
 */
async function ShellBoot() {
  const { user, staff } = await shellIdentity();
  if (mustChangePassword(user)) redirect("/admin/parola-yenile");
  const jar = await cookies();
  const fontScale = resolveFontScale({
    userId: user?.id,
    cookieValue: jar.get(FONT_SCALE_COOKIE)?.value,
    metadataValue: user?.user_metadata?.[FONT_SCALE_META_KEY],
  });
  return (
    <>
      <FontScaleBoot scale={fontScale} />
      <ClientCacheSync identity={`admin:${staff.id}`} />
      <AdminRealtime staffId={staff.id} />
    </>
  );
}

const NO_BADGES: AdminBadges = { tickets: 0, risk: 0, approvals: 0, payments: 0, kvkk: 0 };

async function ShellSidebar() {
  const [{ staff, modules, roleLabel }, menu] = await Promise.all([shellIdentity(), loadMenuOverrides()]);
  // Rozet sayıları BEKLENMEZ: açık talep canlı HEAD sayımı + 30 sn önbellekli risk/onay/tahsilat/KVKK; rozet kendi sınırında akar.
  const badges = getAdminBadges(modules).catch(() => NO_BADGES);
  // Menü yönetimi farkı (grup gizle / sırala): 30 sn önbellekli ayar anlık görüntüsü; yalnız yan menü görünürlüğü.
  return <AdminSidebar staffName={staff.full_name} modules={modules} roleLabel={roleLabel} badges={badges} overrides={menu.admin ?? null} catalog={adminNavCatalog()} />;
}

async function ShellTopbar() {
  const { user, staff, modules, roleLabel } = await shellIdentity();
  const avatar = user ? await loadStaffAvatar(user.id) : null;
  const jar = await cookies();
  const fontScale = resolveFontScale({
    userId: user?.id,
    cookieValue: jar.get(FONT_SCALE_COOKIE)?.value,
    metadataValue: user?.user_metadata?.[FONT_SCALE_META_KEY],
  });
  // Sistem çipi (yalnız "sistem" modülü): sağlık + operasyon hazırlık sinyalleri; çip kendi sınırında akar.
  const health = modules.includes("sistem") ? getAdminHealth().catch(() => null) : null;
  return (
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
      catalog={adminNavCatalog()}
    />
  );
}

async function ShellTabs() {
  const { modules } = await shellIdentity();
  // Sekme koşulları (nav.ts `when`): kupon şeması yoksa Abonelikler > Kuponlar sekmesi çizilmez (önbellekli okuma).
  const planSupport = modules.includes("billing") ? await getPlanSupport().catch(() => null) : null;
  return <AdminSectionTabs modules={modules} conditions={{ coupons: planSupport?.coupons ?? false }} catalog={adminNavCatalog()} />;
}

const STRIP_DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });

/** Kabuk bilgi şeritleri (güvenlik politikası). Önbellekli ayar okumaları; sayfa bunları beklemez. */
async function ShellStrips() {
  const { staff, modules } = await shellIdentity();
  const [mfaPolicy, demoPolicy] = await Promise.all([getPlatformMfaPolicyNow(), getDemoPolicyNow()]);
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
  const strips: StripItem[] = [];
  // Platform güvenlik politikası şeritleri yalnız onu değiştirebilecek kişiye (süper admin); diğer personelin işine ilgisiz.
  if (canManageSecurity && demoPolicy.platform) {
    strips.push({
      key: "demo",
      tone: "danger",
      href: securityHref,
      short: "Platform demo girişi açık",
      text: `Platform demo girişi AÇIK: giriş sayfasındaki kartla herkes tek tıkla süper admin olabilir. ${
        demoPolicy.row?.until ? `Bitiş: ${STRIP_DATE.format(new Date(demoPolicy.row.until))}.` : "Süre sınırı yok (sunucu ortamı ayarı)."
      }${securityHref ? " Kapat →" : ""}`,
    });
  }
  if (canManageSecurity && mfaSyncIssue === "env_on_db_off") {
    strips.push({
      key: "mfa-sync",
      tone: "danger",
      href: securityHref,
      short: "MFA ayarı tutarsız",
      text: 'MFA tutarsız: sunucu ortamında PLATFORM_MFA_ENFORCEMENT açık ama "platform.mfa_enforced" ayarı kapalı; veritabanı personel kapıları MFA istemiyor. Güvenlik politikasından açın.',
    });
  }
  if (canManageSecurity && !mfaPolicy.enforced) {
    strips.push({
      key: "mfa-off",
      tone: "warning",
      href: securityHref,
      short: "İki adımlı doğrulama zorunlu değil",
      text: `Personel için iki adımlı doğrulama (TOTP) zorunlu değil.${securityHref ? " Personel > Güvenlik politikası'ndan açabilirsiniz." : ""}`,
    });
  }
  if (graceDaysLeft !== null && mfaPolicy.graceUntil) {
    strips.push({
      key: "mfa-grace",
      tone: "warning",
      href: "/admin/hesabim?sekme=guvenlik",
      short: `İki adımlı doğrulama ${graceDaysLeft} gün içinde zorunlu`,
      text: `İki adımlı doğrulama ${STRIP_DATE.format(new Date(mfaPolicy.graceUntil))} itibarıyla zorunlu (${graceDaysLeft} gün kaldı). Hesabım > Güvenlik'ten doğrulayıcınızı şimdi kurun.`,
    });
  }
  if (strips.length === 0) return null;
  return <StatusStrips strips={strips} />;
}

type StripItem = { key: string; tone: "warning" | "danger"; href?: string; text: string; short: string };

/**
 * Şeritler: masaüstünde her biri tam metinle; mobilde (B145) TEK satırlık özet (≤44 px): "N uyarı · <en önemlisi>"
 * açılınca tümü listelenir (ilk ekranın %18-29'unu kaplayan iki ayrı şerit yok).
 */
function StatusStrips({ strips }: { strips: StripItem[] }) {
  const top = strips.find((s) => s.tone === "danger") ?? strips[0]!;
  return (
    <>
      <div className="hidden space-y-2 md:block">
        {strips.map((s) => (
          <StatusStrip key={s.key} tone={s.tone} href={s.href}>
            {s.text}
          </StatusStrip>
        ))}
      </div>
      <details className="group md:hidden" data-strip-summary="">
        <summary
          className={`tone-${top.tone} focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] px-3 text-xs font-semibold [&::-webkit-details-marker]:hidden`}
        >
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="line-clamp-1 min-w-0 flex-1">
            {strips.length > 1 ? `${strips.length} uyarı · ` : ""}
            {top.short}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-70 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-2 space-y-2">
          {strips.map((s) => (
            <StatusStrip key={s.key} tone={s.tone} href={s.href}>
              {s.text}
            </StatusStrip>
          ))}
        </div>
      </details>
    </>
  );
}

/**
 * Kalıcı yönetim şeridi. Canlı bölge rolü (`role="status"`) DIŞ kapsayıcıdadır: bağlantıya rol verilirse bağlantı adı ve
 * izinli rol denetimi (axe link-name / aria-allowed-role) bozulur. Şeritler sayfa boyunca kalıcı olduğundan `alert`
 * değil `status` kullanılır (her gezinmede ekran okuyucuyu kesmez); aciliyet tonla (`danger`) verilir. Ton token'lı
 * (`.tone-warning` / `.tone-danger`, açık + koyu temada AA). Bağlantı verilirse tüm şerit ilgili ayara gider (sağda ok).
 */
function StatusStrip({
  tone,
  href,
  children,
}: {
  tone: "warning" | "danger";
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
  return (
    <div role="status">
      {href ? (
        <Link href={href} className={`${cls} focus-ring transition-[filter] hover:brightness-[0.98]`}>
          {body}
        </Link>
      ) : (
        <p className={cls}>{body}</p>
      )}
    </div>
  );
}

/** Yan menü iskeleti: gerçek menüyle aynı genişlik (`shell-aside`) ve yapışkan konum (CLS yok); yalnız masaüstünde. */
function AdminSidebarSkeleton() {
  return (
    <div aria-hidden="true" className="shell-aside shell-track hidden shrink-0 md:block">
    <aside className="shell-aside sb-surface sticky top-0 flex h-dvh flex-col gap-3 overflow-hidden p-4">
      <div className="h-9 w-3/4 rounded-[var(--radius-control)] bg-white/10" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-8 w-full rounded-[var(--radius-control)] bg-white/5" />
      ))}
    </aside>
    </div>
  );
}

/** Üst çubuk iskeleti: gerçek çubukla aynı yükseklik (h-16 + safe-area) ve yapışkan konum (CLS yok). */
function AdminTopbarSkeleton() {
  return (
    <header
      aria-hidden="true"
      className="glass-bar topbar-platform sticky top-0 z-40 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-3 pl-[max(4rem,calc(env(safe-area-inset-left)+3.25rem))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] md:px-6"
    >
      <Skeleton className="hidden h-4 w-40 lg:block" />
      <Skeleton className="mx-auto h-11 w-11 sm:w-full sm:max-w-2xl" />
      <div className="flex shrink-0 items-center gap-2.5">
        <Skeleton className="h-11 w-11 rounded-full" />
        <Skeleton className="h-11 w-11 rounded-full" />
      </div>
    </header>
  );
}
