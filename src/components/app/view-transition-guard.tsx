"use client";

import { useEffect } from "react";

/**
 * View Transitions API, geçiş atlandığında (sekme gizli, hızlı ardışık gezinme,
 * DOM güncellemesi zaman aşımı) `ready`/`finished` promise'lerini reddeder:
 * "Transition was skipped" / "Transition was aborted because of timeout in DOM update".
 * React'in ViewTransition entegrasyonu bu reddi yakalamadığı için konsolda
 * yakalanmamış hata (pageerror) olarak görünüyordu. Geçiş yalnız süs olduğundan
 * ve gezinme/render bundan etkilenmediğinden, YALNIZ bu iki mesaj bastırılır;
 * diğer tüm reddedilmiş promise'ler olduğu gibi raporlanır. Gezinme hızı değişmez.
 */
const SKIPPED = /^Transition was (skipped|aborted)\b/i;

export function ViewTransitionGuard() {
  useEffect(() => {
    function onRejection(event: PromiseRejectionEvent) {
      const reason: unknown = event.reason;
      const message =
        typeof reason === "string"
          ? reason
          : reason && typeof reason === "object" && "message" in reason
            ? String((reason as { message: unknown }).message)
            : "";
      if (SKIPPED.test(message)) event.preventDefault();
    }
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}
