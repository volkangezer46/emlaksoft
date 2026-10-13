import "server-only";
import type { CSSProperties, ReactNode } from "react";
import { SiteImage } from "@/components/marketing/site-image";
import { getSiteMediaView } from "./store";

/** Hero görsel çerçevesi: pazarlama CSS'ine yeni sınıf eklemeden (statik ana sayfa CSS'i değişmesin diye) satır içi stil. */
const FRAME: CSSProperties = { position: "relative", borderRadius: 24, overflow: "hidden", boxShadow: "0 24px 60px -24px rgba(15, 23, 42, 0.35)" };

/**
 * Hero görseli (sunucu bileşeni): medya kaydını etiketli önbellekten okur ve `SiteImage` (öncelikli) çizer.
 * Kayıt yok/okunamıyor (tablo kurulmamış, görsel silinmiş) ise `fallback` (bugünkü ürün sahnesi) çizilir: ana sayfa
 * görselsiz eski haliyle çalışır. `cms` yalnız taslak önizlemesinde verilir (yerinde düzenleme işareti).
 */
export async function StoredHeroImage({ mediaId, alt, fallback, cms = false }: { mediaId: string; alt?: string; fallback: ReactNode; cms?: boolean }) {
  const media = await getSiteMediaView(mediaId).catch(() => null);
  if (!media) return <>{fallback}</>;
  return (
    <div style={FRAME} {...(cms ? { "data-cms-path": "hero.image" } : {})}>
      <SiteImage media={media} alt={alt} priority sizes="(min-width: 1280px) 640px, (min-width: 1024px) 52vw, 100vw" />
    </div>
  );
}
