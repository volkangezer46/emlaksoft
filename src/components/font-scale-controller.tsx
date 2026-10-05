"use client";

import { useEffect } from "react";
import { applyFontScale, clearFontScale, type FontScale } from "@/lib/font-scale";

/**
 * /app ve /admin kabuklarında bir kez yerleştirilir. Sunucunun çözdüğü KAYITLI ölçeği
 * <html data-font-size> olarak yazar; kabuktan çıkılınca (vitrine gidince) kaldırır, böylece
 * public sayfalar her zaman varsayılan boyutta kalır (koyu temayla aynı kural).
 */
export function FontScaleController({ scale }: { scale: FontScale }) {
  useEffect(() => {
    applyFontScale(scale);
  }, [scale]);
  useEffect(() => clearFontScale, []);
  return null;
}
