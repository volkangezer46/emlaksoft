"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LEGACY_HASH_TAB, settingsTabHref, type SettingsTabId } from "./tabs";

/**
 * Eski çapa bağlantısı (`/app/ayarlar#eslestirme-agirliklari`) başka sekmeyi gösteriyorsa doğru `?sekme=`ye geçer.
 * Çapa sunucuya gitmediği için yalnız istemcide çözülür; aynı sekmedeyse dokunmaz (tarayıcı kaydırır).
 */
export function HashTabRedirect({ active }: { active: SettingsTabId }) {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const target = hash ? LEGACY_HASH_TAB[hash] : undefined;
    if (target && target !== active) router.replace(settingsTabHref(target, hash));
  }, [active, router]);
  return null;
}
