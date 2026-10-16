"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { isIos, isStandalone, PWA_KEYS, readNumber, readPushState, writeValue } from "@/lib/push-client";
import { OFFLINE_SCOPE_KEY, SHARE_CACHE } from "@/lib/pwa/intake";
import { now } from "@/lib/clock";
import type { InstallPromptEvent } from "@/components/app/pwa-prompt-card";

// Kart kodu yalnız gösterilecekse iner (kabuk paketine girmez).
const InstallPromptCard = dynamic(() => import("@/components/app/pwa-prompt-card").then((m) => m.InstallPromptCard));
const PushEnableCard = dynamic(() => import("@/components/app/pwa-prompt-card").then((m) => m.PushEnableCard));

const DAY = 86_400_000;
type Show = "install" | "push" | null;

/**
 * Görünmez PWA yardımcısı (panel kabuğunda bir kez): (1) çevrimdışı not kapsam izini yazar, oturum değiştiyse önceki
 * kişinin cihazda bekleyen paylaşımlarını siler; (2) oturum sayar; (3) YALNIZ ana ekranda (/app) ve 3. oturumdan sonra
 * uygulama yükleme kartını (beforeinstallprompt ya da iOS rehberi), yüklüyse/yüklenemiyorsa 2. oturumdan sonra anlık
 * bildirim kartını gösterir. "Şimdi değil" 30 gün geçerlidir. İzin hiçbir zaman sayfa açılırken istenmez.
 */
export function PwaAssist({ scope }: { scope: string | null }) {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [show, setShow] = useState<Show>(null);
  const [ios, setIos] = useState(false);

  // Kapsam izi + oturum değişiminde paylaşım önbelleği temizliği.
  useEffect(() => {
    if (!scope) return;
    try {
      const prev = localStorage.getItem(OFFLINE_SCOPE_KEY);
      if (prev && prev !== scope && "caches" in globalThis) void caches.delete(SHARE_CACHE);
      if (prev !== scope) localStorage.setItem(OFFLINE_SCOPE_KEY, scope);
    } catch {
      /* depolama yok */
    }
  }, [scope]);

  // Oturum sayacı (sekme oturumu başına bir kez) + yükleme olayı.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem(PWA_KEYS.sessionFlag)) {
        sessionStorage.setItem(PWA_KEYS.sessionFlag, "1");
        writeValue(PWA_KEYS.sessions, readNumber(PWA_KEYS.sessions) + 1);
      }
    } catch {
      /* depolama yok */
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setShow(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Karar: yalnız ana ekranda, boşta.
  useEffect(() => {
    if (pathname !== "/app") return;
    let alive = true;
    const handle = window.setTimeout(() => {
      const sessions = readNumber(PWA_KEYS.sessions);
      const t = now();
      const standalone = isStandalone();
      const iosDevice = isIos();
      const installDismissed = t - readNumber(PWA_KEYS.installDismissedAt) < 30 * DAY;
      const pushDismissed = t - readNumber(PWA_KEYS.pushDismissedAt) < 30 * DAY;
      if (!standalone && sessions >= 3 && !installDismissed && (deferred || iosDevice)) {
        setIos(iosDevice);
        setShow("install");
        return;
      }
      if (sessions < 2 || pushDismissed) return;
      void readPushState().then((s) => {
        if (alive && s === "available") setShow("push");
      });
    }, 2500);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [pathname, deferred]);

  if (pathname !== "/app" || !show) return null;
  if (show === "install") {
    return (
      <InstallPromptCard
        deferred={deferred}
        ios={ios}
        onClose={(installed) => {
          if (!installed) writeValue(PWA_KEYS.installDismissedAt, now());
          setDeferred(null);
          setShow(null);
        }}
      />
    );
  }
  return <PushEnableCard floating onClose={() => setShow(null)} />;
}
