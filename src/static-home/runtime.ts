/**
 * Statik ana sayfanın TEK düz JS'i (satır içi; esbuild ile IIFE). React sürümündeki davranışların birebir karşılığı:
 *  - Üst menü: src/components/site-menu/mega-menu.tsx (APG disclosure: aria-expanded, inert, klavye, gecikmeli fare açma,
 *    canlı önizleme katmanı + kart metni), mobil modal sheet (masaüstü panellerden kurulur; inert arka plan, odak tuzağı, Esc).
 *  - Hareket: src/components/marketing/motion-root.tsx (data-motion, js-reveal, .mk-demo duraklatma, akıllı alt çubuk).
 *  - Duyuru: src/components/site-menu/announcement-bar.tsx (kimlik bazlı kapatma + bitiş; ortak saf yardımcılar
 *    src/lib/site-menu/announcements.ts). Sunucu çizimi "/" için seçilen tek duyuruyu taşır.
 *  - Dönüşüm düğmeleri (yönetimden): mobil sheet'teki "Giriş" ve deneme düğmesi üst bardaki düğmelerden okunur.
 *  - Adacıklar (Preact; /statik/*.js): fiyat kartları, koltuk hesaplayıcı, tur ekranları, menü önizlemeleri — görünür alana
 *    yaklaşınca / boşta / menüye ilk yaklaşmada yüklenir.
 * Veriler: <script type="application/json" id="mk-static"> (rota işleyicisi ekler).
 */

import { ANNOUNCEMENT_DISMISS_KEY, addDismissed, parseDismissed } from "@/lib/site-menu/announcements";

type StaticData = {
  islands: Record<"pricing" | "seat" | "tour" | "preview", string>;
  pricing?: unknown;
  seat?: unknown;
};
type SceneCopy = Record<string, { eyebrow?: string; title?: string; text?: string; cta?: string }>;
type PreviewModule = { mount(layers: HTMLElement[]): void; SCENE_COPY: SceneCopy };

const X_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
const ARROW_18 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-right" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';

function readData(): StaticData | null {
  try {
    return JSON.parse(document.getElementById("mk-static")?.textContent ?? "null") as StaticData;
  } catch {
    return null;
  }
}

const data = readData();
const importIsland = <T,>(key: keyof StaticData["islands"]): Promise<T> =>
  data?.islands[key] ? (import(/* @vite-ignore */ data.islands[key]) as Promise<T>) : Promise.reject(new Error("ada yok"));

function whenNear(el: Element, margin: string, run: () => void) {
  if (typeof IntersectionObserver === "undefined") return run();
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    },
    { rootMargin: margin },
  );
  io.observe(el);
}

function whenIdle(run: () => void) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const go = () => (ric ? ric(run, { timeout: 3000 }) : setTimeout(run, 1200));
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/* ------------------------------------------------------------------ üst menü */
function initNav() {
  const nav = document.querySelector<HTMLElement>(".mk-nav");
  if (!nav) return;
  const header = nav.querySelector("header");
  const links = nav.querySelector<HTMLElement>(".mk-nav-links");
  const dds = [...nav.querySelectorAll<HTMLElement>(".mk-dd")];
  const triggerOf = (dd: HTMLElement) => dd.querySelector<HTMLButtonElement>(":scope > button")!;
  const panelOf = (dd: HTMLElement) => dd.querySelector<HTMLElement>(":scope > .mk-mega")!;
  let menu: HTMLElement | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  const onScroll = () => (nav.dataset.scrolled = String(window.scrollY > 8));
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // ---- canlı önizleme (sahneler ve kart metinleri ilk yaklaşmada) ----
  let preview: PreviewModule | null = null;
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    importIsland<PreviewModule>("preview")
      .then((m) => {
        preview = m;
        m.mount([...nav.querySelectorAll<HTMLElement>(".mk-prev-layer[data-kind]")]);
      })
      .catch(() => {});
  };
  links?.addEventListener("pointerenter", arm);
  links?.addEventListener("focusin", arm);

  type FeatState = { href: string; target: string | null; rel: string | null; eyebrow: string | null; title: string; text: string | null; cta: string; ico: string | null };
  const featOrig = new Map<HTMLElement, FeatState>();
  const featOf = (dd: HTMLElement) => dd.querySelector<HTMLAnchorElement>(".mk-mega-feat");
  const ctaText = (a: HTMLElement) => a.querySelector(".mk-mega-feat-cta")?.firstChild;
  const snapshot = (a: HTMLAnchorElement): FeatState => ({
    href: a.getAttribute("href") ?? "",
    target: a.getAttribute("target"),
    rel: a.getAttribute("rel"),
    eyebrow: a.querySelector(".mk-mega-feat-eyebrow")?.textContent ?? null,
    title: a.querySelector(":scope > b")?.textContent ?? "",
    text: a.querySelector(":scope > small")?.textContent ?? null,
    cta: ctaText(a)?.textContent ?? "",
    ico: a.querySelector(".mk-mega-feat-ico")?.innerHTML ?? null,
  });
  const setLayer = (a: HTMLElement, kind: string | null) => {
    const layers = [...a.querySelectorAll<HTMLElement>(".mk-prev-layer")];
    const on = layers.some((l) => l.dataset.kind === kind) ? kind : (layers[0]?.dataset.kind ?? null);
    for (const l of layers) l.dataset.on = String(l.dataset.kind === on);
  };
  const setText = (a: HTMLElement, sel: string, text: string | null | undefined, swap: boolean) => {
    const el = a.querySelector<HTMLElement>(sel);
    if (!el || text == null) return;
    el.textContent = text;
    el.classList.toggle("mk-feat-sw", swap);
  };
  const applyFeat = (a: HTMLAnchorElement, s: FeatState, swap: boolean) => {
    a.setAttribute("href", s.href);
    if (s.target) a.setAttribute("target", s.target);
    else a.removeAttribute("target");
    if (s.rel) a.setAttribute("rel", s.rel);
    else a.removeAttribute("rel");
    setText(a, ".mk-mega-feat-eyebrow", s.eyebrow, swap);
    setText(a, ":scope > b", s.title, swap);
    setText(a, ":scope > small", s.text, swap);
    const c = ctaText(a);
    if (c) c.textContent = s.cta;
    const ico = a.querySelector(".mk-mega-feat-ico");
    if (ico && s.ico != null) ico.innerHTML = s.ico;
  };
  const resetFeat = (dd: HTMLElement) => {
    const a = featOf(dd);
    const orig = a && featOrig.get(a);
    if (!a || !orig) return;
    applyFeat(a, orig, false);
    setLayer(a, null);
  };
  const pick = (dd: HTMLElement, target: EventTarget | null) => {
    const a = featOf(dd);
    if (!a || !a.querySelector(".mk-prev-stack") || menu !== dd) return;
    const li = (target as Element | null)?.closest?.<HTMLElement>("[data-pv]");
    const link = li?.querySelector<HTMLAnchorElement>("a[href]");
    const kind = li?.dataset.pv;
    if (!kind || !link) return;
    if (!featOrig.has(a)) featOrig.set(a, snapshot(a));
    const orig = featOrig.get(a)!;
    const hasLayer = [...a.querySelectorAll<HTMLElement>(".mk-prev-layer")].some((l) => l.dataset.kind === kind);
    setLayer(a, kind);
    if (!hasLayer) return applyFeat(a, orig, false);
    const label = link.querySelector("b")?.firstChild?.textContent ?? "";
    const c = preview?.SCENE_COPY[kind];
    applyFeat(
      a,
      {
        href: link.getAttribute("href") ?? orig.href,
        target: link.getAttribute("target"),
        rel: link.getAttribute("rel"),
        eyebrow: c?.eyebrow ?? label,
        title: c?.title ?? label,
        text: c?.text ?? "",
        cta: c?.cta ?? orig.cta,
        ico: link.querySelector(".mk-panel-ico")?.innerHTML ?? orig.ico,
      },
      true,
    );
  };

  // ---- açma/kapama ----
  const setMenu = (next: HTMLElement | null, focusFirst = false) => {
    if (menu === next) {
      if (focusFirst && next) panelOf(next).querySelector<HTMLElement>("a[href]")?.focus();
      return;
    }
    if (menu && menu !== next) resetFeat(menu);
    menu = next;
    for (const dd of dds) {
      const open = dd === next;
      dd.dataset.open = String(open);
      triggerOf(dd).setAttribute("aria-expanded", String(open));
      panelOf(dd).inert = !open;
    }
    if (next) {
      nav.dataset.menu = triggerOf(next).id.replace(/^mega-btn-/, "");
      arm();
      if (focusFirst) panelOf(next).querySelector<HTMLElement>("a[href]")?.focus();
    } else delete nav.dataset.menu;
  };
  const clearHover = () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
  };

  dds.forEach((dd, index) => {
    const trigger = triggerOf(dd);
    const panel = panelOf(dd);
    dd.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      clearHover();
      hoverTimer = setTimeout(() => setMenu(dd), menu ? 0 : 90);
    });
    dd.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      clearHover();
      hoverTimer = setTimeout(() => menu === dd && setMenu(null), 160);
    });
    dd.addEventListener("focusout", (e) => {
      if (menu === dd && !dd.contains(e.relatedTarget as Node | null)) setMenu(null);
    });
    trigger.addEventListener("click", () => setMenu(menu === dd ? null : dd));
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenu(dd, true);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const next = dds[(index + (e.key === "ArrowRight" ? 1 : -1) + dds.length) % dds.length]!;
        triggerOf(next).focus();
        if (menu) setMenu(next);
      }
    });
    panel.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const all = [...panel.querySelectorAll<HTMLElement>("a[href]")];
      if (all.length === 0) return;
      e.preventDefault();
      const i = all.indexOf(document.activeElement as HTMLElement);
      const to = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : e.key === "ArrowDown" ? (i + 1) % all.length : (i - 1 + all.length) % all.length;
      all[to]!.focus();
    });
    const inner = panel.querySelector<HTMLElement>(".mk-mega-in");
    inner?.addEventListener("pointerover", (e) => pick(dd, e.target));
    inner?.addEventListener("focusin", (e) => pick(dd, e.target));
    inner?.addEventListener("pointerleave", () => resetFeat(dd));
    panel.addEventListener("click", (e) => {
      if ((e.target as Element).closest("a[href]")) setMenu(null);
    });
  });

  // ---- mobil sheet (masaüstü panellerden kurulur) ----
  const burger = nav.querySelector<HTMLButtonElement>(".mk-burger");
  const menuIcon = burger?.innerHTML ?? "";
  let sheet: HTMLElement | null = null;
  let inerted: HTMLElement[] = [];

  const buildSheet = (): HTMLElement => {
    const root = document.createElement("div");
    root.id = "mobile-site-navigation";
    root.className = "mk-sheet";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Site menüsü");
    const sNav = document.createElement("nav");
    sNav.className = "mk-sheet-nav";
    sNav.setAttribute("aria-label", "Mobil site navigasyonu");
    const scroll = document.createElement("div");
    scroll.className = "mk-sheet-scroll";
    for (const item of [...(links?.children ?? [])] as HTMLElement[]) {
      if (item.classList.contains("mk-nav-item")) {
        const src = item.querySelector<HTMLAnchorElement>("a");
        if (!src) continue;
        const a = src.cloneNode(true) as HTMLAnchorElement;
        a.className = "mk-sheet-link";
        scroll.appendChild(a);
        continue;
      }
      if (!item.classList.contains("mk-dd")) continue;
      const trig = triggerOf(item);
      const details = document.createElement("details");
      details.className = "mk-sheet-group";
      const summary = document.createElement("summary");
      summary.append(trig.firstChild?.textContent ?? "");
      const chev = trig.querySelector("svg")?.cloneNode(true) as SVGElement | undefined;
      if (chev) {
        chev.setAttribute("width", "18");
        chev.setAttribute("height", "18");
        summary.appendChild(chev);
      }
      details.appendChild(summary);
      for (const col of item.querySelectorAll<HTMLElement>(".mk-mega-col")) {
        const box = document.createElement("div");
        const title = col.querySelector(".mk-mega-title");
        if (title) {
          const p = document.createElement("p");
          p.className = "mk-sheet-sub";
          p.textContent = title.textContent;
          box.appendChild(p);
        }
        const ul = document.createElement("ul");
        for (const srcA of col.querySelectorAll<HTMLAnchorElement>("li > a")) {
          const li = document.createElement("li");
          const a = srcA.cloneNode(true) as HTMLAnchorElement;
          const ico = a.querySelector(".mk-panel-ico");
          if (ico) ico.replaceWith(...ico.childNodes);
          li.appendChild(a);
          ul.appendChild(li);
        }
        box.appendChild(ul);
        details.appendChild(box);
      }
      const feat = featOf(item);
      if (feat) {
        const f = feat.cloneNode(true) as HTMLAnchorElement;
        f.querySelectorAll(".mk-prev-stack, .mk-feat-media, video, img").forEach((n) => n.remove());
        const orig = featOrig.get(feat);
        if (orig) applyFeat(f, orig, false);
        f.style.setProperty("--i", "0");
        details.appendChild(f);
      }
      scroll.appendChild(details);
    }
    // Giriş ve deneme düğmeleri yönetimden gelir: üst bardaki (sunucu çizimi) düğmelerin metni/hedefi kullanılır.
    const barLogin = nav.querySelector<HTMLAnchorElement>("a.mk-login");
    const barTrial = nav.querySelector<HTMLAnchorElement>("a.mk-nav-trial");
    const external = (a: HTMLAnchorElement, src: HTMLAnchorElement | null) => {
      if (src?.target === "_blank") {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    };
    const login = document.createElement("a");
    login.href = barLogin?.getAttribute("href") || "/giris";
    login.className = "mk-sheet-link";
    login.textContent = barLogin?.textContent?.trim() || "Giriş yap";
    external(login, barLogin);
    scroll.appendChild(login);
    const cta = document.createElement("div");
    cta.className = "mk-sheet-cta";
    const trial = document.createElement("a");
    trial.href = barTrial?.getAttribute("href") || "/kayit";
    trial.className = "mk-btn mk-btn-grad";
    trial.textContent = `${barTrial?.querySelector(".mk-long")?.textContent?.trim() || "Ücretsiz dene"} `;
    trial.insertAdjacentHTML("beforeend", ARROW_18);
    external(trial, barTrial);
    cta.appendChild(trial);
    cta.insertAdjacentHTML("beforeend", `<a href="/fiyatlar" class="mk-btn mk-btn-line">Paketleri ve fiyatları gör</a>`);
    sNav.append(scroll, cta);
    root.appendChild(sNav);
    root.addEventListener("click", (e) => {
      if ((e.target as Element).closest("a[href]")) closeSheet(false);
    });
    return root;
  };

  const focusables = () =>
    [burger, ...(sheet?.querySelectorAll<HTMLElement>("summary, a[href], button:not([disabled])") ?? [])].filter(
      (x): x is HTMLElement => Boolean(x) && (x as HTMLElement).offsetParent !== null,
    );
  const onTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !sheet) return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement as HTMLElement;
    if (e.shiftKey && (active === first || !list.includes(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !list.includes(active))) {
      e.preventDefault();
      first.focus();
    }
  };
  const openSheet = () => {
    if (sheet || !burger) return;
    setMenu(null);
    sheet = buildSheet();
    header?.after(sheet);
    nav.dataset.open = "true";
    burger.setAttribute("aria-expanded", "true");
    burger.setAttribute("aria-label", "Menüyü kapat");
    burger.innerHTML = X_ICON;
    document.documentElement.style.overflow = "hidden";
    inerted = [];
    for (const el of [...(nav.parentElement?.children ?? [])] as HTMLElement[]) {
      if (el === nav || el.tagName === "SCRIPT" || el.inert) continue;
      el.inert = true;
      inerted.push(el);
    }
    window.addEventListener("keydown", onTab);
    sheet.querySelector<HTMLElement>("summary")?.focus();
  };
  const closeSheet = (focusBurger: boolean) => {
    if (!sheet || !burger) return;
    sheet.remove();
    sheet = null;
    nav.dataset.open = "false";
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-label", "Menüyü aç");
    burger.innerHTML = menuIcon;
    document.documentElement.style.overflow = "";
    for (const el of inerted) el.inert = false;
    inerted = [];
    window.removeEventListener("keydown", onTab);
    if (focusBurger) burger.focus();
  };
  burger?.addEventListener("click", () => (sheet ? closeSheet(false) : openSheet()));

  // ---- genel: Esc, dışarı tıklama ----
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (menu) {
      const inPanel = panelOf(menu).contains(document.activeElement);
      const t = triggerOf(menu);
      setMenu(null);
      if (inPanel) t.focus();
    }
    if (sheet) closeSheet(true);
  });
  document.addEventListener("mousedown", (e) => {
    if (menu && !nav.contains(e.target as Node)) setMenu(null);
  });
}

/* ------------------------------------------------------------------ duyuru */
function initAnnouncement() {
  const bar = document.querySelector<HTMLElement>(".mk-ann");
  if (!bar) return;
  const key = bar.dataset.key ?? "";
  const ends = Number(bar.dataset.ends || "0");
  const hide = () => {
    document.documentElement.setAttribute("data-mk-ann-off", "1");
    bar.remove();
    document.querySelector<HTMLElement>(".mk-nav")?.setAttribute("data-ann", "false");
  };
  if (ends && Date.now() > ends) return hide();
  try {
    if (key && parseDismissed(localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY)).includes(key)) return hide();
  } catch {
    /* özel pencere */
  }
  bar.querySelector(".mk-ann-x")?.addEventListener("click", () => {
    try {
      localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, addDismissed(localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY), key));
    } catch {
      /* özel pencere: yalnız bu görünümde kapanır */
    }
    hide();
  });
}

/* ------------------------------------------------------------------ hareket (motion-root.tsx) */
function initMotion() {
  const root = document.querySelector<HTMLElement>(".mk");
  if (!root) return;
  const bar = root.querySelector<HTMLElement>(".mk-sticky-cta[data-smart]");
  if (bar) {
    if (typeof IntersectionObserver === "undefined") bar.dataset.show = "true";
    else {
      const seen = new Set<Element>();
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) seen.add(e.target);
            else seen.delete(e.target);
          }
          bar.dataset.show = String(seen.size === 0);
        },
        { rootMargin: "-56px 0px -56px 0px" },
      );
      root.querySelectorAll(".mk-hero-primary, main a.mk-btn[href^='/kayit'], .mk-final, .mk-foot").forEach((el) => io.observe(el));
    }
  }

  if (typeof IntersectionObserver === "undefined" || navigator.webdriver) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.dataset.motion = "on";

  const targets = [...root.querySelectorAll<HTMLElement>(".mk-reveal, .mk-alt")];
  let ioAlive = false;
  let anyHidden = false;
  for (const el of targets) {
    if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.in = "s";
    else if (el.classList.contains("mk-reveal")) anyHidden = true;
  }
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
  targets.filter((el) => !el.dataset.in).forEach((el) => io.observe(el));
  const revealAll = () => {
    for (const el of targets) if (!el.dataset.in) el.dataset.in = "s";
  };
  if (anyHidden) root.classList.add("js-reveal");
  const net = () => {
    if (!ioAlive) revealAll();
  };
  setTimeout(net, 4000);
  if (document.readyState === "complete") setTimeout(net, 2500);
  else window.addEventListener("load", () => setTimeout(net, 2500), { once: true });
  window.addEventListener("beforeprint", revealAll);

  const demos = [...root.querySelectorAll<HTMLElement>(".mk-demo")];
  if (demos.length === 0) return;
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
  const btns = demos.map((d) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mk-pause";
    btn.setAttribute("aria-pressed", "false");
    btn.textContent = "Animasyonu duraklat";
    btn.addEventListener("click", () => {
      userPaused = !userPaused;
      for (const b of btns) {
        b.setAttribute("aria-pressed", String(userPaused));
        b.textContent = userPaused ? "Animasyonu oynat" : "Animasyonu duraklat";
      }
      apply();
    });
    d.appendChild(btn);
    return btn;
  });
}

/* ------------------------------------------------------------------ adacıklar */
function initIslands() {
  if (!data) return;
  const price = document.getElementById("mk-price-hydrate");
  if (price && data.pricing) {
    whenNear(price, "600px 0px", () => {
      importIsland<{ mount(el: HTMLElement, p: unknown): void }>("pricing")
        .then((m) => m.mount(price, data.pricing))
        .catch((e) => console.warn("[ana sayfa] ada yüklenemedi", e));
    });
  }
  const seat = document.querySelector<HTMLElement>("[data-island='seat-calculator']");
  if (seat && data.seat) {
    whenNear(seat, "400px 0px", () => {
      importIsland<{ mount(el: HTMLElement, p: unknown): void }>("seat")
        .then((m) => m.mount(seat, data.seat))
        .catch((e) => console.warn("[ana sayfa] ada yüklenemedi", e));
    });
  }
  const tours = [...document.querySelectorAll<HTMLElement>(".mk-svg-ph[data-tour]")];
  if (tours.length > 0) {
    whenIdle(() => {
      importIsland<{ mount(els: HTMLElement[]): void }>("tour")
        .then((m) => m.mount(tours))
        .catch((e) => console.warn("[ana sayfa] ada yüklenemedi", e));
    });
  }
}

initNav();
initAnnouncement();
initMotion();
initIslands();
