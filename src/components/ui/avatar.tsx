import { cn } from "@/lib/utils";

const SIZES = { sm: "h-7 w-7 text-xs", md: "h-9 w-9 text-sm", lg: "h-12 w-12 text-base" } as const;

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

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const box = cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold", SIZES[size], className);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- küçük, kullanıcı yüklemeli avatar; next/image alan listesi gerektirir
    return <img src={src} alt={name} className={cn(box, "object-cover")} />;
  }
  return (
    <span role="img" aria-label={name} className={cn(box, TONES[toneIndexOf(name)])}>
      {initialsOf(name)}
    </span>
  );
}
