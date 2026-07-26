"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";

/**
 * İlk giriş ürün turu — kütüphanesiz spotlight.
 *
 * NASIL: Hedef elementin getBoundingClientRect'i ölçülür; tam ekran overlay
 * içinde hedef boyutunda şeffaf bir "delik" div'i konumlanır ve devasa bir
 * box-shadow (0 0 0 9999px) geri kalan her yeri karartır. Delik top/left/
 * width/height geçişiyle adımlar arasında yumuşakça kayar.
 *
 * KURALLAR:
 * - localStorage "emlaksoft:tour-done" → bir kez gösterilir (tur başlar
 *   başlamaz yazılır; yarıda navigasyon olsa da tekrar rahatsız etmez).
 * - ?tv=1 (TV modu) ve prefers-reduced-motion'da hiç başlamaz.
 * - SSR güvenli: yalnız effect sonrası (DOM ölçülebilirken) render edilir.
 * - Bulunamayan / görünmeyen hedefin adımı sessizce atlanır (ör. komut
 *   paleti butonu ya da brifing kartı o an DOM'da yoksa).
 */

const STORAGE_KEY = "emlaksoft:tour-done";
const PAD = 8; // delik ile hedef arası nefes payı (px)
const CARD_W = 336; // balon kart genişliği (px)
const CARD_H = 216; // yerleşim hesabı için tahmini kart yüksekliği (px)
const GAP = 12; // delik ile kart arası boşluk (px)

type TourStep = { selector: string; title: string; desc: string };

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="brifing"]',
    title: "Günaydın brifingi",
    desc: "Gününüz burada özetlenir — randevular, görevler ve sıcak fırsatlar tek bakışta.",
  },
  {
    selector: '[data-tour="kpi"]',
    title: "Canlı KPI kartları",
    desc: "Her sayı tıklanabilir — detaya iner. Trend rozetleri dönem karşılaştırması gösterir.",
  },
  {
    selector: '[data-tour="aksiyonlar"]',
    title: "Görevler ve hızlı aksiyonlar",
    desc: "Kayıtların üzerine gelin, tek tıkla işlem yapın — görevi tamamlayın, müşteriyi arayın.",
  },
  {
    selector: 'header button[aria-haspopup="dialog"]',
    title: "Komut paleti",
    desc: "Ctrl+K ile her şeye ulaşın — müşteri, portföy, anlaşma, görev… hepsi tek kutudan.",
  },
  {
    selector: "aside",
    title: "Modüller",
    desc: "Modüller solda gruplu — Kiralama ve Projeler yeni. İzinli olduğunuz her şey burada.",
  },
];

type Rect = { top: number; left: number; width: number; height: number };
type Phase = "idle" | "run" | "final" | "off";

/** Seçiciyle eşleşen ilk *görünür* elementi döndürür (mobilde gizli aside vb. elenir). */
function findTarget(selector: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(selector);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) return el;
  }
  return null;
}

export function ProductTour() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeSteps, setActiveSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  // Başlatma koşulları — yalnız effect'te (SSR güvenli)
  useEffect(() => {
    let done = false;
    try {
      done = Boolean(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      return; // localStorage yoksa "bir kez" garantisi verilemez → hiç gösterme
    }
    if (done) return;
    if (new URLSearchParams(window.location.search).get("tv") === "1") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Spotlight turu masaüstü deseni — dar ekranda balon içeriği örtüyor
    if (window.innerWidth < 768) return;

    // Giriş animasyonları otursun, sayfa ölçülebilir olsun
    const t = window.setTimeout(() => {
      const found = STEPS.filter((s) => findTarget(s.selector));
      if (found.length === 0) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* yazılamazsa yine de bu oturumda göster */
      }
      setActiveSteps(found);
      setIndex(0);
      setPhase("run");
    }, 800);
    return () => window.clearTimeout(t);
  }, []);

  const close = useCallback(() => setPhase("off"), []);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= activeSteps.length) {
        setPhase("final");
        return i;
      }
      return i + 1;
    });
  }, [activeSteps.length]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Aktif adımın hedefini ölç; resize/scroll'da pozisyonu güncelle
  useEffect(() => {
    if (phase !== "run") return;
    const step = activeSteps[index];
    if (!step) return;
    const el = findTarget(step.selector);
    if (!el) {
      // Hedef bu arada kaybolduysa adımı sessizce atla — setState'i
      // senkron değil mikro-gecikmeyle yap (react-hooks/set-state-in-effect)
      const skip = setTimeout(() => {
        if (index + 1 >= activeSteps.length) setPhase("final");
        else setIndex(index + 1);
      }, 0);
      return () => clearTimeout(skip);
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    let raf = 0;
    const onMove = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [phase, index, activeSteps]);

  // Klavye: Esc kapat, ok tuşları ileri/geri
  useEffect(() => {
    if (phase !== "run" && phase !== "final") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (phase === "run" && (e.key === "ArrowRight" || e.key === "Enter")) {
        e.preventDefault();
        next();
      } else if (phase === "run" && e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, close, next, prev]);

  if (phase === "idle" || phase === "off") return null;

  // ---- Bitiş ekranı: delik yok, ortalanmış kart ----
  if (phase === "final") {
    return (
      <div className="fixed inset-0 z-[95] grid place-items-center bg-[rgba(7,26,56,0.55)] p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Tur tamamlandı"
          className="popover-in w-full max-w-sm rounded-[18px] border border-line bg-surface p-5 shadow-[var(--elev-5)]"
        >
          <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-600/10 text-brand-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Hazırsınız!</h2>
          <p className="mt-1 text-sm text-text-muted">
            Tur tamamlandı — panel artık canlı ofis verinizle çalışıyor.
          </p>
          <p className="mt-3 rounded-[10px] bg-canvas px-3 py-2 text-xs text-text-muted">
            İstediğinde{" "}
            <kbd className="rounded-[5px] border border-line bg-surface px-1.5 py-0.5 font-semibold text-ink-950">?</kbd>{" "}
            klavye kısayollarını,{" "}
            <kbd className="rounded-[5px] border border-line bg-surface px-1.5 py-0.5 font-semibold text-ink-950">Ctrl+K</kbd>{" "}
            komut paletini açar.
          </p>
          <button
            type="button"
            onClick={close}
            className="focus-ring press mt-4 w-full rounded-[11px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700"
          >
            Panele başla
          </button>
        </div>
      </div>
    );
  }

  // ---- Spotlight adımı ----
  const step = activeSteps[index];
  if (!step || !rect) return null;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const hole = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };
  const holeBottom = hole.top + hole.height;
  const holeRight = hole.left + hole.width;

  // Balon yerleşimi: altta → üstte → sağda → viewport altına sabit
  let cardTop: number;
  let cardLeft: number;
  if (vh - holeBottom >= CARD_H + GAP + 8) {
    cardTop = holeBottom + GAP;
    cardLeft = hole.left;
  } else if (hole.top >= CARD_H + GAP + 8) {
    cardTop = hole.top - CARD_H - GAP;
    cardLeft = hole.left;
  } else if (vw - holeRight >= CARD_W + GAP + 8) {
    cardTop = Math.max(16, Math.min(vh / 2 - CARD_H / 2, vh - CARD_H - 16));
    cardLeft = holeRight + GAP;
  } else {
    cardTop = vh - CARD_H - 16;
    cardLeft = hole.left;
  }
  cardLeft = Math.max(16, Math.min(cardLeft, vw - CARD_W - 16));
  cardTop = Math.max(16, cardTop);

  return (
    <div className="fixed inset-0 z-[95]" aria-hidden={false}>
      {/* Spotlight deliği — dev box-shadow geri kalanı karartır */}
      <div
        className="absolute rounded-[18px] transition-[top,left,width,height] duration-300 ease-out"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          boxShadow: "0 0 0 2px rgba(255,255,255,0.85), 0 0 0 9999px rgba(7,26,56,0.55)",
        }}
      />
      {/* Balon kart */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        className="popover-in absolute rounded-[16px] border border-line bg-surface p-4 shadow-[var(--elev-5)] transition-[top,left] duration-300 ease-out"
        style={{ top: cardTop, left: cardLeft, width: CARD_W, maxWidth: "calc(100vw - 32px)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-brand-600">
            Adım {index + 1} / {activeSteps.length}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Turu kapat"
            className="focus-ring -mr-1 -mt-1 grid h-7 w-7 place-items-center rounded-[8px] text-text-faint transition hover:bg-canvas hover:text-ink-950"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="mt-2 font-display text-base font-bold text-ink-950">{step.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">{step.desc}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={close}
            className="focus-ring rounded-[9px] px-2 py-1.5 text-xs font-semibold text-text-faint transition hover:text-ink-950"
          >
            Geç
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={index === 0}
              className="focus-ring press inline-flex items-center gap-1 rounded-[10px] border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Geri
            </button>
            <button
              type="button"
              onClick={next}
              className="focus-ring press inline-flex items-center gap-1 rounded-[10px] bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-700"
            >
              {index + 1 >= activeSteps.length ? "Bitir" : "İleri"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
