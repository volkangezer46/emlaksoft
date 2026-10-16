"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { USER_MENU_TRIGGER_CLASS } from "./user-menu-class";
import { runWhenIdle } from "@/lib/idle";
import { lazyPanel } from "@/lib/lazy-panel";
import type { FontScale } from "@/lib/font-scale";

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
  name: string;
  subtitle: string;
  /** Düğme yüzü: sunucuda çizilmiş `UserMenuFace` (avatar/hazır avatar/baş harf + ad + rol). */
  face: ReactNode;
  links?: UserMenuLink[];
  /** Kayıtlı yazı boyutu (Küçük/Normal/Büyük); sunucu kabuğundan gelir. */
  fontScale?: FontScale;
  /** /app: telefonda tema ve "Yenilikler" avatar menüsündedir (lg altı). */
  appExtras?: boolean;
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
  name,
  face,
  onOpen,
  warm,
}: {
  name: string;
  face: ReactNode;
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
      {face}
    </button>
  );
}
