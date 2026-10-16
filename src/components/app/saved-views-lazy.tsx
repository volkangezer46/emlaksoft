"use client";

import dynamic from "next/dynamic";

/**
 * Kayıtlı görünümler şeridi — tembel sarmalayıcı (liste sayfaları için). Şerit ilk yük JS'inden çıkar; sunucu çıktısı
 * aynen çizilir (ssr açık, CLS yok), parça hidrasyondan hemen sonra iner ve çipler canlanır.
 */
export const SavedViews = dynamic(() => import("./saved-views").then((m) => m.SavedViews));
