/* eslint-disable @next/next/no-img-element -- menü logoları sabit boyutlu <img>; SVG inline gömülmez (CSP/güvenlik) */
import { menuIconComponent } from "./icon-registry";
import { menuAssetUrl } from "./public";
import type { IconRef } from "./schema";

/**
 * Menü ikonunu çizer: kontrollü lucide listesi veya yüklenmiş logo (sabit boyutlu <img>, CLS yok).
 * Sunucu bileşeninde çağrılır; istemciye yalnız hazır öğe gider (ikon paketi istemciye girmez).
 */
export function renderMenuIcon(icon: IconRef, size = 18, assetBase?: (id: string) => string): React.ReactNode {
  if (icon.kind === "lucide") {
    const Icon = menuIconComponent(icon.name);
    return Icon ? <Icon size={size} aria-hidden="true" /> : null;
  }
  if (icon.kind === "media") {
    const src = assetBase ? assetBase(icon.mediaId) : menuAssetUrl(icon.mediaId);
    return <img src={src} width={size + 4} height={size + 4} alt="" decoding="async" className="mk-ico-img" />;
  }
  return null;
}
