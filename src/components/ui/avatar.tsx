import { cn } from "@/lib/utils";
import { resolveAvatar } from "@/lib/avatar-presets";
import { AvatarArt } from "@/components/ui/avatar-art";

const SIZES = {
  xs: "h-6 w-6 text-xs",
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-20 w-20 text-2xl",
} as const;

// Renkler tone-* yardımcılarından: kontrast garantili, dark modda uyumlu.
const TONES = ["tone-info", "tone-success", "tone-warning", "tone-danger", "tone-neutral"] as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toLocaleUpperCase("tr-TR");
}

/** Aynı isim her zaman aynı tonu alır (liste yeniden çizilince renk zıplamaz). */
export function toneIndexOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % TONES.length;
}

/**
 * Ortak avatar: fotoğraf (src) > hazır avatar (preset) > baş harf. Her zaman erişilebilir ad taşır.
 * Fotoğraf yalın <img>: kullanıcı yüklemesi Supabase public URL'idir ve boyut sabittir; next/image
 * dönüştürmesi (alan listesi + ek maliyet) gereksiz.
 */
export function Avatar({
  name,
  src,
  preset,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  preset?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const box = cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold", SIZES[size], className);
  const source = resolveAvatar({ url: src, preset });
  if (source.kind === "photo") {
    // eslint-disable-next-line @next/next/no-img-element -- sabit boyutlu kullanıcı avatarı; next/image alan listesi gerektirir
    return <img src={source.url} alt={name} loading="lazy" decoding="async" className={cn(box, "object-cover")} />;
  }
  if (source.kind === "preset") {
    return (
      <span role="img" aria-label={name} className={box}>
        <AvatarArt preset={source.preset} className="h-full w-full" />
      </span>
    );
  }
  return (
    <span role="img" aria-label={name} className={cn(box, TONES[toneIndexOf(name)])}>
      {initialsOf(name)}
    </span>
  );
}
