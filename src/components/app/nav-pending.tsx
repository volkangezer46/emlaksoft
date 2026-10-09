"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { markSoftNavigated } from "@/lib/soft-nav";

/** Sunucu yanıtı gecikirse anında geri bildirim kalıcı takılı kalmasın (hata/iptal güvencesi). */
const SAFETY_MS = 15_000;

function clearMarks() {
  document.querySelectorAll("[data-nav-pending]").forEach((el) => el.removeAttribute("data-nav-pending"));
  delete document.documentElement.dataset.navBusy;
}

function Inner() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = `${pathname}?${search}`;
  const [from, setFrom] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(key);

  // Adres değişince (gezinme tamamlandı) işaretler kalkar; "bekliyor" durumu türetilmiştir (efektte setState yok).
  useEffect(() => {
    keyRef.current = key;
    clearMarks();
    if (timer.current) clearTimeout(timer.current);
  }, [key]);

  useEffect(() => {
    // Baloncuk aşamasında (React/Next Link işleyicisinden SONRA): Link gezinmeyi başlatıp preventDefault yapmıştır.
    const onClick = (e: MouseEvent) => {
      if (!e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const u = new URL(a.href, window.location.href);
      if (u.origin !== window.location.origin) return;
      const here = window.location.pathname + window.location.search;
      if (u.pathname + u.search === here) return;
      clearMarks();
      markSoftNavigated();
      a.setAttribute("data-nav-pending", "true");
      document.documentElement.dataset.navBusy = "1";
      setFrom(keyRef.current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        clearMarks();
        setFrom(null);
      }, SAFETY_MS);
    };
    document.addEventListener("click", onClick);
    // Geri/ileri ve programatik gezinmeler de yumuşak gezinmedir (süslü giriş hareketleri oynamaz).
    window.addEventListener("popstate", markSoftNavigated);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", markSoftNavigated);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const pending = from !== null && from === key;
  return <div aria-hidden="true" className="nav-progress" data-active={pending ? "true" : "false"} />;
}

/**
 * Tıklamada ANINDA görsel geri bildirim (sunucu turunu beklemeden): tıklanan menü/sekme bağlantısı "bekliyor"
 * işaretlenir (CSS: yan menüde etkin hap, sekmede vurgu) ve üstte ince ilerleme çubuğu açılır. Adres değişince kalkar.
 * Saf istemci: ağ isteği, sunucu turu, ek render yok (yalnız çubuk bir kez açılıp kapanır).
 */
export function NavPending() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
