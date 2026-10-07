import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { SmartIcon } from "@/components/ui/icon-sprite";
import { cn } from "@/lib/utils";

/**
 * EntityThumb — satır başı görsel önizleme.
 *  - `src` varsa sabit kutuda görsel (lazy, CLS yok).
 *  - Görsel yoksa: `name` verilmişse baş harf avatarı (müşteri), değilse `icon` yer tutucusu (portföy).
 * `src` kimlik doğrulamalı download ucundan gelir; bu yüzden next/image `unoptimized`.
 */
const BOX = {
  sm: "h-10 w-14",
  md: "h-12 w-[4.5rem]",
} as const;

export function EntityThumb({
  src,
  alt,
  icon: Icon,
  name,
  size = "md",
  className,
}: {
  src?: string | null;
  alt: string;
  icon?: LucideIcon;
  /** Verilirse ve görsel yoksa baş harf avatarı çizilir (yuvarlak). */
  name?: string;
  size?: keyof typeof BOX;
  className?: string;
}) {
  if (!src && name) {
    return <Avatar name={name} size={size === "sm" ? "md" : "lg"} className={className} />;
  }
  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] bg-[image:var(--grad-brand-soft)] ring-1 ring-inset ring-line",
        BOX[size],
        className,
      )}
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes="72px" className="object-cover" unoptimized />
      ) : Icon ? (
        <SmartIcon icon={Icon} className="h-5 w-5 text-brand-600/45" />
      ) : null}
    </span>
  );
}
