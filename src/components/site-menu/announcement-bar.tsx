"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { isPast } from "@/lib/clock";
import type { PublicAnnouncement } from "@/lib/site-menu/public";

/**
 * Üst duyuru şeridi. Bitiş tarihi geçince (sayfa önbellekte kalmış olsa bile) istemcide de gizlenir;
 * kapatma tercihi tarayıcıda saklanır (duyuru metni/bağlantısı değişince anahtar değişir ve şerit yeniden görünür).
 * Daha önce kapatılmışsa ilk boyamada yer kaplamaması için sunucu çıktısındaki küçük betik <html>'e işaret koyar
 * (`data-mk-ann-off`); CSS şeridi gizler (CLS yok). Betik: ANNOUNCEMENT_BOOT_SCRIPT (site-header.tsx).
 */

const STORE_KEY = "mk-ann-off";
const EVENT = "mk-ann-change";

function readOff(key: string): boolean {
  try {
    return window.localStorage.getItem(STORE_KEY) === key;
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function AnnouncementBar({ a }: { a: PublicAnnouncement }) {
  const dismissed = useSyncExternalStore(subscribe, () => readOff(a.key), () => false);
  const expired = useSyncExternalStore(subscribe, () => isPast(a.endsAtMs), () => false);
  if (dismissed || expired) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORE_KEY, a.key);
    } catch {
      /* özel pencere: yalnız bu sayfa görünümünde kapanır */
    }
    document.documentElement.setAttribute("data-mk-ann-off", "1");
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <div className="mk-ann" role="region" aria-label="Duyuru">
      <p>
        {a.text}
        {a.href ? (
          <>
            {" "}
            <a href={a.href} {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {a.linkLabel}
              {a.external ? <span className="sr-only"> (yeni sekmede açılır)</span> : null}
            </a>
          </>
        ) : null}
      </p>
      {a.dismissible ? (
        <button type="button" className="mk-ann-x" aria-label="Duyuruyu kapat" onClick={dismiss}>
          <X size={18} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
