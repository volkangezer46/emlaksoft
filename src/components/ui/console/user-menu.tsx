"use client";

import { Suspense, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { USER_MENU_TRIGGER_CLASS, UserMenuFace } from "./user-menu-face";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";
import type { FontScale } from "@/lib/font-scale";
import type { UiPrefs } from "@/lib/ui-prefs";

export type UserMenuLink = { href: string; label: string } & (
  | { icon: LucideIcon; iconName?: never }
  | { iconName: "settings" | "back" | "account"; icon?: never }
);


/**
 * Üst çubuk kullanıcı menüsü — hafif kabuk. Radix DropdownMenu gövdesi (bağlantılar, görünüm
 * tercihleri, çıkış formu) ilk etkileşime kadar yüklenmez: tık veya hover/odak (önceden ısıtma).
 * Yüklenince gerçek menü aynı görünümlü düğmeyi devralır ve açık gelir. Parça önceden indiyse
 * tık anında askıya alınmadan açılır (`lazyPanel`).
 */
const panel = lazyPanel(() => import("./user-menu-panel").then((m) => m.UserMenuPanel));

export function UserMenu(props: {
  initials: string;
  name: string;
  subtitle: string;
  /** Profil fotoğrafı / hazır avatar (yoksa baş harf). */
  avatarUrl?: string | null;
  avatarPreset?: string | null;
  links?: UserMenuLink[];
  /** Sade görünüm (çerez adı ofis+kullanıcı kapsamlı); yoksa bölüm gösterilmez. */
  viewPrefs?: { cookieName: string; initial: UiPrefs };
  /** Kayıtlı yazı boyutu (Küçük/Normal/Büyük); sunucu kabuğundan gelir. */
  fontScale?: FontScale;
}) {
  const [Panel, setPanel] = useState<ReturnType<typeof panel.resolve> | null>(null);
  // Sayfa boşalınca panel parçasını arka planda indir: ilk tıklama beklemesin (hover/odak ısıtması ek güvence).
  useEffect(() => runWhenIdle(panel.preload), []);
  if (Panel) {
    return (
      <Suspense fallback={<Trigger {...props} />}>
        <Panel {...props} initialOpen />
      </Suspense>
    );
  }
  return <Trigger {...props} onOpen={() => setPanel(() => panel.resolve())} warm={panel.preload} />;
}

function Trigger({
  initials,
  name,
  subtitle,
  avatarUrl,
  avatarPreset,
  onOpen,
  warm,
}: {
  initials: string;
  name: string;
  subtitle: string;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
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
      className={USER_MENU_TRIGGER_CLASS}
    >
      <UserMenuFace initials={initials} name={name} subtitle={subtitle} avatarUrl={avatarUrl} avatarPreset={avatarPreset} />
    </button>
  );
}
