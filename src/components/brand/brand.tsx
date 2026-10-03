"use client";

/* eslint-disable @next/next/no-img-element -- marka SVG/PNG dosyaları <img> ile servis edilir (CSP: SVG inline gömülmez) */
import { createContext, useContext } from "react";
import {
  EMPTY_BRAND_META,
  resolveBrandSrc,
  type BrandMeta,
  type BrandTone,
  type BrandVariant,
} from "@/lib/brand/slots";

/**
 * Tek marka bileşeni: logo/sembol kullanan HER yer bunu kullanır (başlık, alt bilgi, yan menü,
 * giriş paneli, yasal sayfalar). Özel marka (süper admin yüklemesi) kök layout'taki
 * <BrandProvider> üzerinden gelir; yoksa public/brand varsayılanları kullanılır.
 * Ofis bazlı (beyaz etiket) logo bu bileşenin kapsamı DIŞINDADIR (tenants.logo_url ayrı).
 */

const BrandContext = createContext<BrandMeta>(EMPTY_BRAND_META);

export function BrandProvider({ meta, children }: { meta: BrandMeta; children: React.ReactNode }) {
  return <BrandContext.Provider value={meta}>{children}</BrandContext.Provider>;
}

export function useBrandMeta(): BrandMeta {
  return useContext(BrandContext);
}

type BrandProps = {
  variant?: BrandVariant;
  /** light: açık zemin, dark: koyu zemin, auto: /app ve /admin koyu temasına göre değişir. */
  tone?: BrandTone | "auto";
  /** Piksel yükseklik; genişlik orantılı. */
  height?: number;
  className?: string;
  alt?: string;
  /** Verilirse bileşen yerine bu meta kullanılır (önizleme/test). */
  metaOverride?: BrandMeta;
};

const MARK_ASPECT = 1;

export function Brand({ variant = "horizontal", tone = "light", height = 32, className, alt = "EmlakSoft", metaOverride }: BrandProps) {
  const ctx = useBrandMeta();
  const meta = metaOverride ?? ctx;
  const style = { height, width: "auto", aspectRatio: variant === "mark" ? String(MARK_ASPECT) : undefined } as const;

  if (tone === "auto") {
    return (
      <span className={`inline-flex items-center ${className ?? ""}`} data-brand={variant}>
        <img
          src={resolveBrandSrc(meta, variant, "light")}
          alt={alt}
          style={style}
          className="block [html[data-theme=dark]_&]:hidden"
          decoding="async"
        />
        <img
          src={resolveBrandSrc(meta, variant, "dark")}
          alt={alt}
          style={style}
          className="hidden [html[data-theme=dark]_&]:block"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <img
      src={resolveBrandSrc(meta, variant, tone)}
      alt={alt}
      style={style}
      className={`block shrink-0 ${className ?? ""}`}
      data-brand={variant}
      decoding="async"
    />
  );
}
