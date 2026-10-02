"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const LEGACY_PRIVACY_UNSAFE_CACHES = ["emlaksoft-static-v4", "emlaksoft-pages-v4"] as const;

/**
 * SW kaydı + sürüm güncelleme çubuğu.
 *
 * Privacy migration v6 activates immediately and clears the legacy v4 caches.
 * Later versions can use the normal waiting flow below: the user confirms the
 * update and controllerchange reloads the page exactly once.
 */
export function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const hadControllerAtMount = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    const onControllerChange = () => {
      // skipWaiting sonrası yeni SW devraldı → tek sefer reload
      if (!hadControllerAtMount) return;
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const legacyCleanup = "caches" in globalThis
      ? Promise.allSettled(LEGACY_PRIVACY_UNSAFE_CACHES.map((name) => caches.delete(name)))
      : Promise.resolve([]);

    void legacyCleanup
      .then(() =>
        navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        }),
      )
      .then((reg) => {
        // Do not wait for the browser's periodic update check during the v6
        // privacy migration. sw.js itself remains no-store at the HTTP layer.
        void reg.update().catch(() => undefined);
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
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 shadow-[0_16px_40px_-16px_rgba(7,26,56,0.35)]">
        <p className="text-sm font-medium text-ink-950">Yeni sürüm hazır</p>
        <button
          type="button"
          onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-600/90"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Yenile
        </button>
      </div>
    </div>
  );
}
