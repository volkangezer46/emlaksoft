"use client";

import { Suspense, use, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { usePathname } from "next/navigation";
import { CommandPaletteLazy } from "@/components/admin/command-palette-lazy";
import { NotificationBell } from "@/components/admin/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { UserMenu } from "@/components/ui/console/user-menu";
import { now } from "@/lib/clock";
import { Building2, LifeBuoy, Plus, Undo2, UserRound } from "lucide-react";
import type { PlatformModule } from "@/lib/platform-access";
import type { FontScale } from "@/lib/font-scale";
import type { AdminHealth } from "@/lib/admin-badges";
import { activeAdminItem, activeTabHref } from "@/lib/admin/nav";
import { SystemStatusChip } from "@/components/admin/system-status-chip";

/** "+ Yeni" menüsü YALNIZ eylemlerdir (sayfa gezintisi yan menü ve ⌘K'dadır; kopya kısayol yok). */
const QUICK: { label: string; href: string; icon: typeof Building2; module: PlatformModule }[] = [
  { label: "Yeni ofis aç", href: "/admin/tenants/yeni", icon: Building2, module: "tenants" },
  { label: "Yeni destek talebi", href: "/admin/tickets/yeni", icon: LifeBuoy, module: "tickets" },
];

// Not: `tagline` prop'u alınıyor ama hiçbir yerde render edilmiyordu (h-14
// başlık çubuğunda üçüncü satıra yer yok). Yanıltıcı API yerine kaldırıldı.
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
  const [clock, setClock] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const quickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () =>
      setClock(new Date(now()).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setQuickOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuickOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Başlık menü tek kaynağından (src/lib/admin/nav.ts); menü dışı sayfa "Platform".
  const activeItem = activeAdminItem(pathname);
  const title = activeItem?.label ?? (pathname.startsWith("/admin/bildirimler") ? "Bildirimler" : pathname.startsWith("/admin/hesabim") ? "Hesabım" : "Platform");
  // Menü öğesinin ilk sekmesi dışındaki sekmede (Ofisler > Üyeler) konum şeridi sekmeyi de söyler; yoksa "Üyeler" sayfasında "Ofisler" yazardı.
  const tabHref = activeItem?.tabs?.length ? activeTabHref(pathname, activeItem.tabs) : null;
  const activeTab = tabHref && tabHref !== activeItem?.tabs?.[0]?.href ? activeItem?.tabs?.find((t) => t.href === tabHref) : undefined;
  const crumbs = activeItem && activeTab && activeTab.label !== activeItem.label
    ? [{ label: "Platform", href: "/admin" }, { label: activeItem.label, href: activeItem.href }, { label: activeTab.label }]
    : [{ label: "Platform", href: "/admin" }, { label: title }];
  const quickItems = QUICK.filter((q) => modules.includes(q.module));

  return (
    // iOS PWA (B135): `viewportFit: cover` + yarı saydam durum çubuğu: çubuk durum çubuğu kadar uzar (üst dolgu), yatayda
    // çentik kadar içeri alınır; hamburger (sol boşluk) layout'ta aynı değişkenle kayar.
    <header className="glass-bar topbar-platform sticky top-0 z-40 flex h-[calc(4rem+env(safe-area-inset-top))] items-center gap-3 pl-[max(4rem,calc(env(safe-area-inset-left)+3.25rem))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))]">
      {/* Sol: ev ikonlu konum şeridi — platform / sayfa (rol, kullanıcı menüsünde ve yan menü başlığında görünür) */}
      <Breadcrumb
        className="hidden shrink-0 lg:block"
        home={{ href: "/admin", label: "Kontrol paneli" }}
        items={crumbs}
      />

      {/* Orta: arama — flex-1 ile boş alanı kapla, çok geniş ekranda okunur genişlikte kal */}
      <div className="mx-auto min-w-0 max-w-2xl flex-1">
        <CommandPaletteLazy modules={modules} />
      </div>

      <div className="flex items-center gap-2.5">
        {quickItems.length > 0 ? (
          <div ref={quickRef} className="relative">
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              aria-expanded={quickOpen}
              aria-haspopup="menu"
              aria-controls="admin-quick-menu"
              className="focus-ring press inline-flex h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg shadow-[0_8px_20px_-10px_color-mix(in_srgb,var(--accent)_80%,transparent)] transition-colors hover:bg-accent-hover"
            >
              <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Yeni</span>
            </button>
            {quickOpen ? (
              <div id="admin-quick-menu" role="menu" className="absolute right-0 top-12 w-56 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-1.5 shadow-[0_24px_50px_-20px_rgba(10,34,71,0.5)]">
                {quickItems.map((q) => (
                  <Link
                    key={q.href}
                    href={q.href}
                    role="menuitem"
                    onClick={() => setQuickOpen(false)}
                    className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-sm text-ink-950 transition hover:bg-canvas"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-control)] bg-canvas text-brand-600">
                      <q.icon className="h-3.5 w-3.5" />
                    </span>
                    {q.label}
                  </Link>
                ))}
              </div>
            ) : null}
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

        <ThemeToggle className="rounded-full border-hairline bg-surface-raised shadow-[var(--elev-1)] hover:border-border-interactive sm:h-11 sm:w-11" />

        <NotificationBell />

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
