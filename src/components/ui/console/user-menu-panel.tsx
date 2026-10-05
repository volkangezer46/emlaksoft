"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LogOut, Map as MapIcon, Settings, Undo2, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { clearTourDone, TOUR_RESTART_HREF } from "@/lib/product-tour-storage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ViewPrefs } from "@/components/ui/console/view-prefs";
import { FontScalePicker } from "@/components/font-scale-picker";
import type { FontScale } from "@/lib/font-scale";
import type { UiPrefs } from "@/lib/ui-prefs";
import type { UserMenuLink } from "./user-menu";

const NAMED_ICONS: Record<"settings" | "back" | "account", LucideIcon> = { settings: Settings, back: Undo2, account: UserRound };

/** Menü gövdesi (Radix DropdownMenu) — user-menu.tsx tarafından ilk etkileşimde yüklenir. */
export function UserMenuPanel({
  initials,
  name,
  subtitle,
  links = [],
  viewPrefs,
  fontScale,
  initialOpen,
}: {
  initials: string;
  name: string;
  subtitle: string;
  links?: UserMenuLink[];
  /** Sade görünüm + yazı boyutu (çerez adı ofis+kullanıcı kapsamlı); yoksa bölüm gösterilmez. */
  viewPrefs?: { cookieName: string; initial: UiPrefs };
  /** Kayıtlı yazı boyutu (sunucuda çözülür); verilmezse bölüm gösterilmez. */
  fontScale?: FontScale;
  initialOpen?: boolean;
}) {
  // Ürün turu yalnız ofis panelinde (/app) vardır; yönetim konsolunda gösterilmez.
  const inApp = (usePathname() ?? "").startsWith("/app");
  return (
    <DropdownMenu defaultOpen={initialOpen}>
      <DropdownMenuTrigger
        aria-label={`Kullanıcı menüsü: ${name}`}
        className="focus-ring flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-1 transition-colors hover:border-brand-300 sm:pr-2"
      >
        <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] bg-[image:var(--grad-brand)] text-xs font-bold text-white" aria-hidden>
          {initials}
        </span>
        <span className="hidden min-w-0 text-left xl:block">
          <span className="block max-w-28 truncate text-xs font-semibold text-text">{name}</span>
          <span className="block max-w-28 truncate text-xs text-text-muted">{subtitle}</span>
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-text-faint sm:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-semibold text-text">{name}</span>
          <span className="block truncate text-xs font-normal text-text-muted">{subtitle}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.map((l) => (
          <DropdownMenuItem key={l.href} asChild>
            <Link href={l.href}>
              {(() => {
                const Icon = l.icon ?? NAMED_ICONS[l.iconName];
                return <Icon aria-hidden />;
              })()}
              {l.label}
            </Link>
          </DropdownMenuItem>
        ))}
        {inApp ? (
          <DropdownMenuItem
            onSelect={() => {
              clearTourDone();
              window.location.assign(TOUR_RESTART_HREF);
            }}
          >
            <MapIcon aria-hidden />
            Turları yeniden başlat
          </DropdownMenuItem>
        ) : null}
        {links.length > 0 || inApp ? <DropdownMenuSeparator /> : null}
        {viewPrefs ? (
          <>
            <ViewPrefs cookieName={viewPrefs.cookieName} initial={viewPrefs.initial} />
            <DropdownMenuSeparator />
          </>
        ) : null}
        {fontScale ? (
          <>
            <FontScalePicker initial={fontScale} className="px-3 py-2" />
            <DropdownMenuSeparator />
          </>
        ) : null}
        <form action={signOut}>
          <DropdownMenuItem asChild danger>
            <button type="submit" className="w-full">
              <LogOut aria-hidden />
              Çıkış yap
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
