"use client";

import dynamic from "next/dynamic";

/**
 * Portföy detayının sekme içi AĞIR istemci bölümleri (medya yöneticisi + sürükle-bırak/yükleme, anahtar kaydı + telefon
 * girişi, fiyat geçmişi grafiği, sahip portalı). Detay sayfası sekmelidir; bu bölümler açılış sekmesinde görünmese de
 * statik içe aktarıldıkları için ilk yük JS'ine giriyordu. `next/dynamic` (SSR açık): çıktı aynı, parça bölüm çizilince iner.
 */
const PANEL = () => <div aria-hidden="true" className="skeleton h-48 w-full rounded-[var(--radius-card)]" />;

export const PropertyMediaManager = dynamic(() => import("./property-media-manager").then((m) => m.PropertyMediaManager), { loading: PANEL });
export const PropertyPriceHistory = dynamic(() => import("./property-price-history").then((m) => m.PropertyPriceHistory), { loading: PANEL });
export const PropertyKeysSection = dynamic(() => import("./property-keys-section").then((m) => m.PropertyKeysSection), { loading: PANEL });
export const OwnerPortalPanel = dynamic(() => import("./owner-portal-panel").then((m) => m.OwnerPortalPanel), { loading: PANEL });
/** Yeni portföy formundan gelen fotoğrafların kayıt sonrası yükleme ilerlemesi (kuyruk boşsa hiçbir şey çizmez). */
export const PropertyPhotoUploadStatus = dynamic(
  () => import("@/components/app/property-photo-upload-status").then((m) => m.PropertyPhotoUploadStatus),
  { ssr: false },
);
