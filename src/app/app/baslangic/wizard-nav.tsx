"use client";

import NextLink, { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import SmartLink from "@/components/ui/smart-link";

/**
 * Sihirbaz gezinmesi (B038): komşu adımlar (Geri/İleri) TAM önyüklenir (`prefetch`), böylece geçiş önbellekten gelir;
 * tıklama anında (aynı karede) bekleme durumu gösterilir: `useLinkStatus` + basılma sınıfı. Bekleme göstergesi sabit
 * boyutludur ve yalnız opaklığı değişir (CLS yok).
 */
function PendingMark() {
  const { pending } = useLinkStatus();
  return (
    <Loader2
      aria-hidden
      className={`h-3.5 w-3.5 shrink-0 animate-spin transition-opacity motion-reduce:animate-none ${pending ? "opacity-100" : "opacity-0"}`}
    />
  );
}

/** Bağlantı bekleme durumunu ekran okuyucuya ve stile (`data-pending`) yansıtan kabuk. */
function PendingState({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span data-pending={pending ? "" : undefined} aria-busy={pending || undefined} className="contents">
      {children}
    </span>
  );
}

export function WizardLink({
  href,
  prefetchFull = false,
  className,
  children,
  ...rest
}: Omit<ComponentProps<typeof NextLink>, "prefetch"> & { href: string; prefetchFull?: boolean; children: ReactNode }) {
  const content = (
    <PendingState>
      {children}
      <PendingMark />
    </PendingState>
  );
  // Komşu adım: tam önyükleme (prefetch=true). Diğerleri: SmartLink (niyet olunca ısıtma).
  return prefetchFull ? (
    <NextLink {...rest} href={href} prefetch className={className}>
      {content}
    </NextLink>
  ) : (
    <SmartLink {...rest} href={href} className={className}>
      {content}
    </SmartLink>
  );
}

/**
 * Adım şeridinde etkin çipi görünür alana getirir (B138-d): mount'ta ve adım değişince şerit yatayda kaydırılır,
 * etkin çip ortalanır. Sayfa dikeyde kaydırılmaz (yalnız şeridin `scrollLeft`'i).
 */
export function ActiveChipIntoView({ current }: { current: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const strip = ref.current?.closest("nav")?.querySelector<HTMLElement>("ol");
    const chip = strip?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!strip || !chip) return;
    const left = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
  }, [current]);
  return <span ref={ref} hidden />;
}
