"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { now } from "@/lib/clock";
import { ANNOUNCEMENT_DISMISS_KEY, addDismissed, parseDismissed, pickAnnouncement } from "@/lib/site-menu/announcements";
import type { PublicAnnouncement } from "@/lib/site-menu/public";

/**
 * Üst duyuru şeridi. Yönetimden en çok 5 duyuru gelir; sayfada TEK duyuru görünür: Türkiye gününe göre aktif, yola uyan,
 * kapatılmamış ve en yüksek öncelikli olan (`pickAnnouncement`, saf). Sunucu çizimi sayfanın çizildiği anla seçer; tarayıcı
 * gerçek saat ve kapatılanlarla yeniden seçer (önbellekte kalmış sayfada bitiş/başlangıç da doğru işler).
 * Kapatma tarayıcıda kimlik bazlı saklanır (`mk-ann-off`, boşlukla ayrılmış anahtarlar; anahtar = kimlik + içerik özeti,
 * metin/bağlantı/tarih değişince duyuru yeniden görünür). Daha önce kapatılmışsa ilk boyamada yer kaplamaması için sunucu
 * çıktısındaki küçük betik <html>'e işaret koyar (`data-mk-ann-off`); CSS şeridi gizler (CLS yok). Betik: site-header.tsx.
 * Statik ana sayfa aynı anahtarı src/static-home/runtime.ts'te okur.
 */

const EVENT = "mk-ann-change";

function readRaw(): string {
  try {
    return window.localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY) ?? "";
  } catch {
    return "";
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

/** Gösterilecek duyuru. Sunucu/ilk hidrasyon: `renderedAt` anı, kapatma bilgisi yok; tarayıcı: gerçek saat + kapatılanlar. */
export function usePickedAnnouncement(list: readonly PublicAnnouncement[] | undefined, renderedAt: number): PublicAnnouncement | null {
  const path = usePathname() ?? "/";
  const id = useSyncExternalStore(
    subscribe,
    () => (list?.length ? (pickAnnouncement(list, path, now(), parseDismissed(readRaw()))?.id ?? "") : ""),
    () => (list?.length ? (pickAnnouncement(list, path, renderedAt)?.id ?? "") : ""),
  );
  return id ? (list?.find((a) => a.id === id) ?? null) : null;
}

export function AnnouncementBar({ a }: { a: PublicAnnouncement }) {
  // Önceki duyuru kapatılmışken sıradaki duyuru gösteriliyorsa ilk boyamadaki gizleme işareti kaldırılır.
  useEffect(() => {
    if (!parseDismissed(readRaw()).includes(a.id)) document.documentElement.removeAttribute("data-mk-ann-off");
  }, [a.id]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, addDismissed(readRaw(), a.id));
    } catch {
      /* özel pencere: yalnız bu sayfa görünümünde kapanır */
    }
    document.documentElement.setAttribute("data-mk-ann-off", "1");
    window.dispatchEvent(new Event(EVENT));
  };

  return (
    <div className="mk-ann" role="region" aria-label="Duyuru" data-key={a.id} data-ends={a.endsAtMs ?? undefined}>
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
