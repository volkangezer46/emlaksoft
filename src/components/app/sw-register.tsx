"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * SW kaydı + sürüm güncelleme çubuğu.
 *
 * sw.js install sırasında skipWaiting ÇAĞIRMAZ; yeni sürüm "waiting" durumunda
 * bekler. Burada updatefound/waiting yakalanır, kullanıcıya "Yeni sürüm hazır —
 * Yenile" çubuğu gösterilir. Yenile → SKIP_WAITING mesajı → controllerchange →
 * sayfa reload (yeni sürümle temiz açılış).
 */
export function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let reloading = false;
    const onControllerChange = () => {
      // skipWaiting sonrası yeni SW devraldı → tek sefer reload
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Sekme açıkken zaten bekleyen bir sürüm varsa hemen göster
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            // controller yoksa ilk kurulumdur — çubuk yalnız gerçek güncellemede
            if (next.state === "installed" && navigator.serviceWorker.controller) setWaiting(next);
          });
        });
      })
      .catch(() => {
        /* sessiz */
      });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;

  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-2.5 shadow-[0_16px_40px_-16px_rgba(7,26,56,0.35)]">
        <p className="text-sm font-medium text-ink-950">Yeni sürüm hazır</p>
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-600/90"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Yenile
        </button>
      </div>
    </div>
  );
}
