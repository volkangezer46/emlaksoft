import { ChevronDown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { resolveAvatar } from "@/lib/avatar-presets";
import { PRESENCE_DOT, PRESENCE_LABEL, type PresenceStatus } from "@/lib/presence";

/**
 * Kullanıcı menüsü tetikleyicisinin TEK görünümü. SUNUCUDA çizilir (app/admin layout) ve `face` olarak verilir:
 * hafif kabuk `user-menu.tsx` ve Radix gövdesi `user-menu-panel.tsx` aynı düğümü basar (panel yüklenince düğme
 * sıçramaz; avatar hazır ayarları/çizimleri istemci paketine girmez). Lacivert baş harf dairesi + ad + ofis adı + aşağı ok (v4);
 * dar ekranda yalnız avatar.
 */
export { USER_MENU_TRIGGER_CLASS } from "./user-menu-class";

export function UserMenuFace({
  initials,
  name,
  subtitle,
  avatarUrl,
  avatarPreset,
  presence = null,
}: {
  initials: string;
  name: string;
  subtitle: string;
  avatarUrl?: string | null;
  avatarPreset?: string | null;
  /** /app ekip durumu: avatarın sağ altında renkli nokta (seçilmemişse yok). */
  presence?: PresenceStatus | null;
}) {
  // Üst çubukta yalnız YÜKLENMİŞ fotoğraf çizilir; hazır avatar çizimi yerine baş harfli daire (kurumsal referans "HG").
  const hasAvatar = resolveAvatar({ url: avatarUrl, preset: avatarPreset }).kind === "photo";
  const face = hasAvatar ? (
    <span aria-hidden className="shrink-0">
      <Avatar name={name} src={avatarUrl} size="md" />
    </span>
  ) : (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(160deg,var(--navy-600),var(--navy-900))] text-xs font-bold tracking-wide text-white shadow-[0_0_0_2px_var(--surface),0_0_0_3px_var(--hairline)]" aria-hidden>
      {initials}
    </span>
  );
  return (
    <>
      {presence ? (
        <span className="relative shrink-0">
          {face}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full shadow-[0_0_0_2px_var(--surface)]"
            style={{ background: presence === "offline" ? "transparent" : PRESENCE_DOT[presence], boxShadow: presence === "offline" ? `inset 0 0 0 2px ${PRESENCE_DOT.offline}, 0 0 0 2px var(--surface)` : undefined }}
            aria-hidden
          />
          <span className="sr-only">Durum: {PRESENCE_LABEL[presence]}</span>
        </span>
      ) : (
        face
      )}
      <span className="hidden min-w-0 text-left lg:block">
        <span className="block max-w-36 truncate text-sm font-bold leading-5 text-[var(--heading)]">{name}</span>
        <span className="block max-w-36 truncate text-xs text-text-muted">{subtitle}</span>
      </span>
      <ChevronDown className="hidden h-4 w-4 text-text-faint sm:block" aria-hidden />
    </>
  );
}
