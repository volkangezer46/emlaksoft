/**
 * Platform markası: slot tanımları ve çözümleme (saf, istemci/sunucu ortak).
 * Varsayılan dosyalar public/brand/* altındadır (scripts/generate-brand.mjs üretir);
 * süper admin /admin/marka'dan slot başına özel dosya yükleyebilir.
 */

export const BRAND_SLOTS = ["logo-light", "logo-dark", "mark", "favicon"] as const;
export type BrandSlot = (typeof BRAND_SLOTS)[number];

export type BrandAssetType = "svg" | "png";

export type BrandSlotInfo = { type: BrandAssetType; v: number; bytes: number };
export type BrandMeta = { slots: Partial<Record<BrandSlot, BrandSlotInfo>> };

export const EMPTY_BRAND_META: BrandMeta = { slots: {} };

export const BRAND_SLOT_LABELS: Record<BrandSlot, { label: string; hint: string; square: boolean }> = {
  "logo-light": { label: "Logo (açık zemin)", hint: "Beyaz/açık arka planda kullanılan yatay logo.", square: false },
  "logo-dark": { label: "Logo (koyu zemin)", hint: "Koyu yan menü ve giriş panelinde kullanılan yatay logo.", square: false },
  mark: { label: "Sembol", hint: "Kare sembol; daraltılmış menü ve küçük alanlar için.", square: true },
  favicon: { label: "Favicon", hint: "Tarayıcı sekmesi ve ana ekran simgesi; kare olmalı.", square: true },
};

/** Slot başına dosya boyutu sınırı (bayt). Platform ayarı metin sütununda base64 saklandığı için küçük tutulur. */
export const BRAND_MAX_BYTES: Record<BrandAssetType, number> = {
  svg: 100 * 1024,
  png: 256 * 1024,
};

export const BRAND_PNG_MIN_SIDE = 32;
export const BRAND_PNG_MAX_SIDE = 2048;

export const DEFAULT_BRAND_ASSETS = {
  markLight: "/brand/logo-mark.svg",
  markDark: "/brand/logo-mark-dark.svg",
  horizontalLight: "/brand/logo-horizontal.svg",
  horizontalDark: "/brand/logo-horizontal-dark.svg",
  verticalLight: "/brand/logo-vertical.svg",
  verticalDark: "/brand/logo-vertical-dark.svg",
  monoLight: "/brand/logo-mono.svg",
  monoDark: "/brand/logo-mono-white.svg",
  favicon: "/icon.svg",
  faviconIco: "/favicon.ico",
  appleTouch: "/brand/apple-touch-icon.png",
} as const;

export function isBrandSlot(value: string): value is BrandSlot {
  return (BRAND_SLOTS as readonly string[]).includes(value);
}

export function brandAssetUrl(slot: BrandSlot, info: BrandSlotInfo): string {
  return `/brand-asset/${slot}?v=${info.v}`;
}

export type BrandVariant = "horizontal" | "vertical" | "mark" | "mono";
export type BrandTone = "light" | "dark";

/** Bir kullanım için gösterilecek görselin yolunu seçer (özel yükleme varsa o, yoksa varsayılan). */
export function resolveBrandSrc(meta: BrandMeta, variant: BrandVariant, tone: BrandTone): string {
  const dark = tone === "dark";
  switch (variant) {
    case "mark": {
      const m = meta.slots.mark;
      if (m) return brandAssetUrl("mark", m);
      return dark ? DEFAULT_BRAND_ASSETS.markDark : DEFAULT_BRAND_ASSETS.markLight;
    }
    case "mono":
      return dark ? DEFAULT_BRAND_ASSETS.monoDark : DEFAULT_BRAND_ASSETS.monoLight;
    case "vertical":
    case "horizontal": {
      const slot: BrandSlot = dark ? "logo-dark" : "logo-light";
      const info = meta.slots[slot];
      if (info) return brandAssetUrl(slot, info);
      if (variant === "vertical") return dark ? DEFAULT_BRAND_ASSETS.verticalDark : DEFAULT_BRAND_ASSETS.verticalLight;
      return dark ? DEFAULT_BRAND_ASSETS.horizontalDark : DEFAULT_BRAND_ASSETS.horizontalLight;
    }
  }
}
