"use client";

import NextLink, { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { type ComponentProps, type ReactNode } from "react";
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
