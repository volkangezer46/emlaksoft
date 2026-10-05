"use client";

import { useEffect } from "react";

/**
 * Ana sayfa hareket altyapısı. Markup EKLEMEZ (return null); yalnız .mk köküne işaret koyar ve öğe niteliklerini yönetir.
 *
 *  - data-motion="on": hareket serbest (IntersectionObserver var, reduce değil, otomasyon tarayıcısı değil). CSS'teki tüm
 *    animasyonlar bu işarete bağlıdır; işaret yoksa (JS yok / reduce / webdriver) sayfa SON KARE durağan görünür.
 *  - js-reveal: ekran altında .mk-reveal öğesi varsa eklenir; yalnız viewport ALTINDAKİ öğeler gizlenir, görününce data-in="1" ile gelir.
 *    Açılışta görünür olanlar data-in="s" alır (animasyonsuz). Güvenlik ağı: IO hiç yanıt vermezse (4 sn / load+2,5 sn) ve yazdırmada hepsi açılır.
 *  - .mk-demo: ekran dışı / sekme gizli / kullanıcı duraklattı => data-paused="true" (CSS animation-play-state: paused).
 *    Görünür "Animasyonu duraklat" düğmesi (WCAG 2.2.2, aria-pressed) yalnız hareket açıkken DOM'a eklenir.
 * Fare/imleç konumu izlenmez.
 */
export function MotionRoot() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".mk");
    if (!root || typeof IntersectionObserver === "undefined") return;
    if (navigator.webdriver) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    root.dataset.motion = "on";
    const cleanups: Array<() => void> = [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    /* ---- kaydırmayla giriş ---- */
    const targets = [...root.querySelectorAll<HTMLElement>(".mk-reveal, .mk-alt")];
    let ioAlive = false;
    let anyHidden = false;
    for (const el of targets) {
      if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.in = "s";
      else if (el.classList.contains("mk-reveal")) anyHidden = true;
    }
    const pending = targets.filter((el) => !el.dataset.in);
    const io = new IntersectionObserver(
      (entries) => {
        ioAlive = true;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "1";
          io.unobserve(e.target);
        }
      },
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
    );
    pending.forEach((el) => io.observe(el));
    const revealAll = () => {
      for (const el of targets) if (!el.dataset.in) el.dataset.in = "s";
    };
    if (anyHidden) root.classList.add("js-reveal");
    const net = () => {
      if (!ioAlive) revealAll();
    };
    timers.push(setTimeout(net, 4000));
    const onLoad = () => timers.push(setTimeout(net, 2500));
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    window.addEventListener("beforeprint", revealAll);
    cleanups.push(() => {
      io.disconnect();
      window.removeEventListener("load", onLoad);
      window.removeEventListener("beforeprint", revealAll);
      root.classList.remove("js-reveal");
      delete root.dataset.motion;
    });

    /* ---- sürekli/uzun hareket: .mk-demo ---- */
    const demos = [...root.querySelectorAll<HTMLElement>(".mk-demo")];
    if (demos.length > 0) {
      let userPaused = false;
      const visible = new Map<HTMLElement, boolean>();
      const apply = () => {
        for (const d of demos) d.dataset.paused = String(userPaused || document.hidden || visible.get(d) === false);
      };
      const demoIo = new IntersectionObserver((entries) => {
        for (const e of entries) visible.set(e.target as HTMLElement, e.isIntersecting);
        apply();
      });
      demos.forEach((d) => demoIo.observe(d));
      document.addEventListener("visibilitychange", apply);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mk-pause";
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = "Animasyonu duraklat";
      btn.addEventListener("click", () => {
        userPaused = !userPaused;
        btn.setAttribute("aria-pressed", String(userPaused));
        btn.textContent = userPaused ? "Animasyonu oynat" : "Animasyonu duraklat";
        apply();
      });
      demos[0]!.appendChild(btn);
      cleanups.push(() => {
        demoIo.disconnect();
        document.removeEventListener("visibilitychange", apply);
        btn.remove();
        for (const d of demos) delete d.dataset.paused;
      });
    }

    return () => {
      timers.forEach(clearTimeout);
      cleanups.forEach((c) => c());
    };
  }, []);

  return null;
}
