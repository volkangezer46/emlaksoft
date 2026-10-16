"use client";

import dynamic from "next/dynamic";

/**
 * Kabuk içi 404 paneli tembel: not-found sınırı her /app rotasının ilk yük JS'ine girer, ama panel yalnız olmayan
 * kayıtta çizilir. Sunucu çıktısı tam paneldir (ssr açık); parça inince odak/bağlantılar canlanır.
 */
export const NotFoundPanel = dynamic(() => import("./not-found-panel").then((m) => m.NotFoundPanel));
