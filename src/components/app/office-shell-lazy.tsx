"use client";

import dynamic from "next/dynamic";

/**
 * Kabuk yuvalarının TEMBEL istemci parçaları (paket bütçesi: scripts/check-bundle-budget.ts). Platform banner'ı (AD8) ve
 * yeniden onay penceresi (AD12) Radix Dialog, düğme, ikonlar ve sunucu eylemi taşır; çoğu gezinmede GEREKMEZ. Gerekip
 * gerekmediğine SUNUCU karar verir (office-broadcast-slots / legal-reconsent-gate) ve yalnız gerekiyorsa bunları çizer.
 * `next/dynamic` (ssr açık): HTML sunucuda hemen çizilir (banner şeridi yerinde, onay penceresi ilk boyamada ekranı
 * kilitler; çıkış formu hidrasyondan önce de çalışır), etkileşimli kod ayrı parçada iner → kabuğun ilk yük JS'ine girmez.
 */
export const PlatformBannerLazy = dynamic(() => import("./platform-banner").then((m) => m.PlatformBanner));
export const LegalReconsentModalLazy = dynamic(() => import("./legal-reconsent-modal").then((m) => m.LegalReconsentModal));
/** Ürün içi NPS kartı (DG8): yalnız sorulacak anket varken (nps-prompt-slot) çizilir; SSR kapalı (gösterim istemcide yazılır). */
export const NpsPromptLazy = dynamic(() => import("./nps-prompt").then((m) => m.NpsPrompt), { ssr: false });
