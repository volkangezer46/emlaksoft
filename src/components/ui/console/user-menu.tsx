"use client";

import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UiPrefs } from "@/lib/ui-prefs";

export type UserMenuLink = { href: string; label: string } & (
  | { icon: LucideIcon; iconName?: never }
  | { iconName: "settings" | "back"; icon?: never }
);


/**
 * Üst çubuk kullanıcı menüsü — hafif kabuk. Radix DropdownMenu gövdesi (bağlantılar, görünüm
 * tercihleri, çıkış formu) ilk etkileşime kadar yüklenmez: tık veya hover/odak (önceden ısıtma).
 * Yüklenince gerçek menü aynı görünümlü düğmeyi devralır ve açık gelir.
 */
const loadPanel = () => import("./user-menu-panel").then((m) => ({ default: m.UserMenuPanel }));
const Panel = lazy(loadPanel);

export function UserMenu(props: {
  initials: string;
  name: string;
  subtitle: string;
  links?: UserMenuLink[];
  /** Sade görünüm + yazı boyutu (çerez adı ofis+kullanıcı kapsamlı); yoksa bölüm gösterilmez. */
  viewPrefs?: { cookieName: string; initial: UiPrefs };
}) {
  const [mounted, setMounted] = useState(false);
  if (mounted) {
    return (
      <Suspense fallback={<Trigger {...props} />}>
        <Panel {...props} initialOpen />
      </Suspense>
    );
  }
  return <Trigger {...props} onOpen={() => setMounted(true)} warm={() => void loadPanel()} />;
}

function Trigger({
  initials,
  name,
  subtitle,
  onOpen,
  warm,
}: {
  initials: string;
  name: string;
  subtitle: string;
  onOpen?: () => void;
  warm?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={warm}
      onFocus={warm}
      aria-haspopup="menu"
      aria-expanded={false}
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
    </button>
  );
}
