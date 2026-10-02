"use client";

import { useEffect } from "react";
import { applyTheme, subscribeTheme } from "@/lib/theme";

/**
 * /app ve /admin layout'larında bir kez yerleştirilir. Tercih değişince
 * data-theme'i günceller; bu alandan çıkılırken (ör. vitrine gidince) kaldırır,
 * böylece public sayfalar her zaman açık temada kalır.
 */
export function ThemeController() {
  useEffect(() => {
    applyTheme();
    const unsubscribe = subscribeTheme(applyTheme);
    return () => {
      unsubscribe();
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);
  return null;
}
