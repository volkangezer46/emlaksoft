"use client";

import Link from "@/components/ui/smart-link";
import { usePathname } from "next/navigation";
import { LogOut, Map as MapIcon, Settings, Sparkles, Undo2, UserRound } from "lucide-react";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { USER_MENU_TRIGGER_CLASS } from "./user-menu-class";
import type { LucideIcon } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { clearTourDone, TOUR_RESTART_HREF } from "@/lib/product-tour-storage";
import { clearFieldCaptureStorage, countUnsentOnDevice } from "@/lib/field-capture/outbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FontScaleMenuItems, ViewPrefs } from "@/components/ui/console/view-prefs";
import type { FontScale } from "@/lib/font-scale";
import type { UiPrefs } from "@/lib/ui-prefs";
import type { UserMenuLink } from "./user-menu";
import { isThemePref, readThemePref, subscribeTheme, writeThemePref, type ThemePref } from "@/lib/theme";
import { requestWhatsNewOpen } from "@/components/app/whats-new-signal";

const THEME_CHOICES: readonly { value: ThemePref; label: string }[] = [
  { value: "system", label: "Cihaza göre" },
  { value: "light", label: "Açık" },
  { value: "dark", label: "Koyu" },
];

/**
 * Tema (C-üst çubuk, plan 2.3): telefonda üst çubukta yalnız arama, zil ve avatar kalır; tema seçimi buraya taşınır
 * (masaüstünde üst çubuktaki düğme durur, bu bölüm yalnız lg altında görünür).
 */
function ThemeMenuItems() {
  const pref = useSyncExternalStore(subscribeTheme, readThemePref, () => "system" as ThemePref);
  return (
    <div className="lg:hidden">
      <DropdownMenuLabel>Tema</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={pref} onValueChange={(v) => (isThemePref(v) ? writeThemePref(v) : undefined)} aria-label="Tema">
        {THEME_CHOICES.map((c) => (
          <DropdownMenuRadioItem key={c.value} value={c.value} onSelect={(e) => e.preventDefault()}>
            {c.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </div>
  );
}

const NAMED_ICONS: Record<"settings" | "back" | "account", LucideIcon> = { settings: Settings, back: Undo2, account: UserRound };

/**
 * Çıkış: hızlı kayıt taslakları ve çevrimdışı kuyruk (ad, telefon) bu cihazda bir sonraki kullanıcıya kalmasın diye
 * silinir. Gönderilmemiş kayıt varsa önce ConfirmDialog ile sorulur; vazgeçilirse çıkış yapılmaz.
 */
async function signOutClearingDevice() {
  clearFieldCaptureStorage();
  await signOut();
}

/** Menü gövdesi (Radix DropdownMenu) — user-menu.tsx tarafından ilk etkileşimde yüklenir. */
export function UserMenuPanel({
  name,
  subtitle,
  face,
  links = [],
  viewPrefs,
  fontScale,
  appExtras = false,
  initialOpen,
}: {
  name: string;
  subtitle: string;
  /** Sunucuda çizilmiş düğme yüzü (hafif kabukla AYNI düğüm). */
  face: ReactNode;
  links?: UserMenuLink[];
  /** Sade görünüm + yazı boyutu (çerez adı ofis+kullanıcı kapsamlı); yoksa bölüm gösterilmez. */
  viewPrefs?: { cookieName: string; initial: UiPrefs };
  /** Kayıtlı yazı boyutu (sunucuda çözülür); verilmezse bölüm gösterilmez. */
  fontScale?: FontScale;
  /** /app üst çubuğu: telefonda tema ve "Yenilikler" bu menüdedir (lg altı). */
  appExtras?: boolean;
  initialOpen?: boolean;
}) {
  // Ürün turu yalnız ofis panelinde (/app) vardır; yönetim konsolunda gösterilmez.
  const inApp = (usePathname() ?? "").startsWith("/app");
  // Onay penceresi menünün DIŞINDA durur: menü kapanınca içeriği sökülür, pencere açık kalmalı.
  const [unsentToConfirm, setUnsentToConfirm] = useState(0);
  function onSignOutSubmit(event: FormEvent<HTMLFormElement>) {
    const unsent = countUnsentOnDevice();
    if (unsent > 0) {
      event.preventDefault();
      setUnsentToConfirm(unsent);
      return;
    }
    clearFieldCaptureStorage();
  }
  return (
    <>
      <DropdownMenu defaultOpen={initialOpen}>
        <DropdownMenuTrigger aria-label={`Kullanıcı menüsü: ${name}`} className={USER_MENU_TRIGGER_CLASS}>
          {face}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72">
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-semibold text-text">{name}</span>
            <span className="block truncate text-xs font-normal text-text-muted">{subtitle}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Yazı boyutu en üstte (plan 2.3): görme zorluğu çeken kullanıcı ilk bakışta bulur. */}
          {fontScale ? (
            <>
              <FontScaleMenuItems initial={fontScale} />
              <DropdownMenuSeparator />
            </>
          ) : null}
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
          {appExtras ? (
            <DropdownMenuItem className="lg:hidden" onSelect={() => requestWhatsNewOpen()}>
              <Sparkles aria-hidden />
              Yenilikler
            </DropdownMenuItem>
          ) : null}
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
          {/* Görünüm tercihleri gerçek menü öğeleridir (onay kutusu + radyo grubu): ok tuşlarıyla ulaşılır, anında uygulanır. */}
          {viewPrefs ? (
            <>
              <ViewPrefs cookieName={viewPrefs.cookieName} initial={viewPrefs.initial} />
              <DropdownMenuSeparator />
            </>
          ) : null}
          {appExtras ? <ThemeMenuItems /> : null}
          <form action={signOut} onSubmit={onSignOutSubmit}>
            <DropdownMenuItem asChild danger>
              <button type="submit" className="w-full">
                <LogOut aria-hidden />
                Çıkış yap
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={unsentToConfirm > 0}
        onOpenChange={(next) => {
          if (!next) setUnsentToConfirm(0);
        }}
        title="Gönderilmemiş hızlı kayıtlar var"
        description={`Bu cihazda gönderilmemiş ${unsentToConfirm} hızlı kayıt var. Çıkış yaparsanız bu cihazdan silinir.`}
        confirmLabel="Yine de çıkış yap"
        tone="danger"
        formAction={signOutClearingDevice}
      />
    </>
  );
}
