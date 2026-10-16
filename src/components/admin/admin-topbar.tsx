"use client";

import { Suspense, use, useEffect, useState, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { usePathname, useSearchParams } from "next/navigation";
import { CommandPaletteLazy } from "@/components/admin/command-palette-lazy";
import { NotificationBell } from "@/components/admin/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { PortalMenu } from "@/components/ui/portal-menu";
import { TopbarFreshness } from "@/components/app/topbar-freshness";
import { QUICK_CREATE_TRIGGER_CLASS } from "@/components/app/quick-create-trigger";
import { UserMenu } from "@/components/ui/console/user-menu";
import { now } from "@/lib/clock";
import { Building2, CalendarDays, ChevronDown, ChevronRight, LifeBuoy, Megaphone, Plus, Receipt, Undo2, UserPlus, UserRound } from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";
import type { FontScale } from "@/lib/font-scale";
import type { AdminHealth } from "@/lib/admin-badges";
import { activeAdminItem, activeTabHref, adminNavFor } from "@/lib/admin/nav";
import { SystemStatusChip } from "@/components/admin/system-status-chip";

/** "+ Yeni" menüsü YALNIZ eylemlerdir (sayfa gezintisi yan menü ve ⌘K'dadır; kopya kısayol yok). */
const QUICK: { label: string; href: string; icon: typeof Building2; module: PlatformModule }[] = [
  { label: "Yeni ofis aç", href: "/admin/tenants/yeni", icon: Building2, module: "tenants" },
  { label: "Yeni destek talebi", href: "/admin/tickets/yeni", icon: LifeBuoy, module: "tickets" },
  { label: "Yeni fatura", href: "/admin/billing/faturalar/yeni", icon: Receipt, module: "billing" },
  { label: "Toplu duyuru gönder", href: "/admin/duyuru", icon: Megaphone, module: "broadcast" },
  { label: "Personel davet et", href: "/admin/personel/yeni", icon: UserPlus, module: "personel" },
];

const ICON_BTN =
  "focus-ring press hidden h-10 w-10 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border border-hairline bg-surface text-text-muted shadow-[var(--elev-1)] transition hover:bg-surface-hover hover:text-text lg:grid";

/**
 * /admin ÜST ÇUBUĞU (ofis paneli v4 referansıyla aynı yerleşim, `AppTopbar`): solda sayfa başlığı + tazelik ("Son
 * güncelleme 14:32 · Taze"), ortada geniş arama (Ctrl K), sağda "+ Yeni ▾" (portal menüsü; kart katmanlarının arkasında
 * kalmaz), sistem durumu çipi, tema, bildirim zili, ajanda (görevler) ve profil. Telefonda yalnız arama, zil ve profil.
 */
export function AdminTopbar({
  roleLabel,
  staffName,
  userFace,
  modules,
  fontScale,
  health = null,
}: {
  roleLabel: string;
  staffName: string;
  /** Kullanıcı menüsü düğme yüzü: sunucuda çizilmiş `UserMenuFace` (avatar çizimleri istemci paketine girmez). */
  userFace: ReactNode;
  modules: PlatformModule[];
  fontScale?: FontScale;
  /**
   * Gerçek sağlık ölçümü (yalnız "sistem" modülü görenlere); yoksa çip çizilmez. Söz (promise) olarak gelir: üst çubuk
   * ölçümü BEKLEMEZ, çip kendi küçük Suspense sınırında akar (o ana dek yalnız saat).
   */
  health?: Promise<AdminHealth | null> | AdminHealth | null;
}) {
  const pathname = usePathname();
  const sekme = useSearchParams()?.get("sekme");
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () =>
      setClock(new Date(now()).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // Başlık menü tek kaynağından (src/lib/admin/nav.ts; menü yönetiminde gizlenen grubun sayfası da başlığını korur).
  const activeItem = activeAdminItem(pathname, adminNavFor(modules), sekme);
  const title = activeItem?.label ?? (pathname.startsWith("/admin/hesabim") ? "Hesabım" : "Platform");
  // Menü öğesinin ilk sekmesi dışındaki sekmede (Abonelikler > Planlar) başlık sekmeyi de söyler.
  const tabHref = activeItem?.tabs?.length ? activeTabHref(pathname, activeItem.tabs, sekme) : null;
  const activeTab = tabHref && tabHref !== activeItem?.tabs?.[0]?.href ? activeItem?.tabs?.find((t) => t.href === tabHref) : undefined;
  const quickItems = QUICK.filter((q) => modules.includes(q.module));

  return (
    // iOS PWA (B135): `viewportFit: cover` + yarı saydam durum çubuğu: çubuk durum çubuğu kadar uzar (üst dolgu), yatayda
    // çentik kadar içeri alınır; hamburger (sol boşluk) layout'ta aynı değişkenle kayar.
    <header className="glass-bar app-topbar topbar-platform sticky top-0 z-40 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-3 pl-[max(4rem,calc(env(safe-area-inset-left)+3.25rem))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))]">
      <div className="flex min-w-0 flex-1 items-center gap-5">
        {/* Sol: sayfa başlığı (üst öğe › sekme) + tazelik; xl ve üstü (1366 px'te arama ve sağ grup sığar). */}
        <div className="hidden w-[14.5rem] min-w-0 shrink-0 flex-col justify-center gap-1 xl:flex">
          <nav aria-label="Konum" className="min-w-0">
            <ol className="flex min-w-0 items-baseline gap-1 whitespace-nowrap leading-5">
              {activeTab && activeItem ? (
                <li className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                  <Link href={activeItem.href} className="focus-ring max-w-[7rem] truncate rounded-sm transition-colors hover:text-text" title={activeItem.label}>
                    {activeItem.label}
                  </Link>
                  <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" aria-hidden />
                </li>
              ) : null}
              <li className="min-w-0">
                <span aria-current="page" className="block truncate font-display text-base font-bold tracking-tight text-[var(--heading)]" title={activeTab?.label ?? title}>
                  {activeTab?.label ?? title}
                </span>
              </li>
            </ol>
          </nav>
          <TopbarFreshness />
        </div>
        {/* Orta: arama — boş alanı kaplar, çok geniş ekranda okunur genişlikte kalır */}
        <div className="topbar-search min-w-0 flex-1 lg:max-w-[30rem] 2xl:max-w-[36rem]">
          <CommandPaletteLazy modules={modules} />
        </div>
      </div>

      {/* Sağ grup arama kutusunun ÜSTÜNDE (z-10): dar ekranda çakışsa bile tıklama kendi düğmesine düşer. */}
      <div className="relative z-10 flex shrink-0 items-center gap-1.5 sm:gap-2">
        {quickItems.length > 0 ? (
          <div className="mr-1 hidden lg:flex">
            <PortalMenu
              label="Hızlı ekle menüsü"
              align="end"
              triggerClassName={QUICK_CREATE_TRIGGER_CLASS}
              trigger={
                <>
                  <Plus className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Yeni</span>
                  <span className="qc-sep hidden sm:block" aria-hidden />
                  <ChevronDown className="hidden h-4 w-4 opacity-80 sm:block" aria-hidden />
                </>
              }
            >
              {quickItems.map((q) => (
                <Link
                  key={q.href}
                  href={q.href}
                  className="focus-ring flex min-h-10 items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm text-ink-950 transition hover:bg-canvas touch:min-h-11"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-canvas text-brand-600">
                    <q.icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 truncate">{q.label}</span>
                </Link>
              ))}
            </PortalMenu>
          </div>
        ) : null}

        {/* Tek sade durum göstergesi: sistem durumu + saat aynı çipte (sağlık ölçümü yoksa yalnız saat). */}
        {health ? (
          <Suspense fallback={<ClockChip clock={clock} />}>
            <HealthChip health={health} clock={clock} />
          </Suspense>
        ) : (
          <ClockChip clock={clock} />
        )}

        <ThemeToggle className="rounded-[var(--radius-control)] border-hairline bg-surface shadow-[var(--elev-1)] hover:border-border-interactive sm:h-10 sm:w-10" />

        <NotificationBell />

        {modules.includes("tenants") ? (
          <Link href="/admin/gorevler" aria-label="Ajanda: görevler ve takipler" title="Ajanda: görevler" className={ICON_BTN}>
            <CalendarDays className="h-[18px] w-[18px]" aria-hidden />
          </Link>
        ) : null}

        <span className="mx-1 hidden h-8 w-px bg-hairline lg:block" aria-hidden />

        <UserMenu
          name={staffName}
          face={userFace}
          subtitle={roleLabel}
          fontScale={fontScale}
          links={[
            { href: "/admin/hesabim", label: "Hesabım", icon: UserRound },
            { href: "/app", label: "Ofis paneline dön", icon: Undo2 },
          ]}
        />
      </div>
    </header>
  );
}

function ClockChip({ clock }: { clock: string }) {
  if (!clock) return null;
  return (
    <span className="hidden h-11 items-center gap-2 rounded-full border border-hairline bg-surface-raised px-3.5 text-sm font-semibold tabular-nums text-text-muted shadow-[var(--elev-1)] lg:inline-flex" aria-label={`Saat ${clock}`}>
      <span className="status-pulse h-2 w-2 rounded-full bg-mint-500" aria-hidden /> {clock}
    </span>
  );
}

/** Sağlık sözü çözülünce sistem çipi; ölçüm okunamadıysa yalnız saat. */
function HealthChip({ health, clock }: { health: Promise<AdminHealth | null> | AdminHealth; clock: string }) {
  const h = "then" in health ? use(health) : health;
  return h ? <SystemStatusChip health={h} clock={clock} /> : <ClockChip clock={clock} />;
}
