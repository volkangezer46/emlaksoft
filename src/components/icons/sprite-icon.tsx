/** Kök layout'taki `IconSpriteDefs` sembolüne başvuran hafif ikon (istemci/sunucu ortak, bağımlılıksız). */
export type SpriteIconName = "check" | "arrow-right" | "shield-check" | "scale" | "clock";

export function SpriteIcon({ name, size = 24, className }: { name: SpriteIconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <use href={`#si-${name}`} />
    </svg>
  );
}
