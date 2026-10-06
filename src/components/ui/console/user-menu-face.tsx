import { ChevronDown } from "lucide-react";

/**
 * Kullanıcı menüsü tetikleyicisinin TEK görünümü (hafif kabuk `user-menu.tsx` ve Radix gövdesi
 * `user-menu-panel.tsx` aynı yüzü çizer; panel yüklenince düğme sıçramaz). Yuvarlak vurgu
 * avatarı + ad + rol + aşağı ok; dar ekranda yalnız avatar.
 */
export const USER_MENU_TRIGGER_CLASS =
  "focus-ring flex h-11 items-center gap-2.5 rounded-full border border-hairline bg-surface-raised p-1 shadow-[var(--elev-1)] transition-colors hover:border-border-interactive sm:pr-3";

export function UserMenuFace({ initials, name, subtitle }: { initials: string; name: string; subtitle: string }) {
  return (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg" aria-hidden>
        {initials}
      </span>
      <span className="hidden min-w-0 text-left lg:block">
        <span className="block max-w-32 truncate text-sm font-semibold leading-4 text-text">{name}</span>
        <span className="block max-w-32 truncate text-xs text-text-muted">{subtitle}</span>
      </span>
      <ChevronDown className="hidden h-4 w-4 text-text-faint sm:block" aria-hidden />
    </>
  );
}
