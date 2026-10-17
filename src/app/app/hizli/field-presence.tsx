"use client";

import { useEffect } from "react";
import { markFieldPresence } from "@/app/actions/presence";
import { now, trDayKey } from "@/lib/clock";

const KEY = "es:field-presence-day";

/**
 * Saha modu açılınca ekip durumu "Sahada" olur (bugün başka bir durum seçilmediyse; karar sunucuda `shouldAutoField`).
 * Cihaz başına günde bir çağrı (sessionStorage); hata sessizdir, sayfayı etkilemez. Hiçbir şey çizmez.
 */
export function FieldPresence() {
  useEffect(() => {
    const day = trDayKey(now());
    try {
      if (window.sessionStorage.getItem(KEY) === day) return;
      window.sessionStorage.setItem(KEY, day);
    } catch {
      /* depolama kapalı: yine de bir kez dener */
    }
    void markFieldPresence().catch(() => undefined);
  }, []);
  return null;
}
