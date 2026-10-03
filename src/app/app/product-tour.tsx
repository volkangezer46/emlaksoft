"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { TOUR_PARAM, TOUR_STORAGE_KEY } from "@/lib/product-tour-storage";
import {
  Dialog,
  DialogDescription,
  DialogFullscreenContent,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * İlk giriş ürün turu — ölçümü yerel, modal davranışı ortak Radix altyapısında
 * çalışan spotlight.
 *
 * NASIL: Hedef elementin getBoundingClientRect'i ölçülür; tam ekran overlay
 * içinde hedef boyutunda şeffaf bir "delik" div'i konumlanır ve devasa bir
 * box-shadow (0 0 0 9999px) geri kalan her yeri karartır. Konum transform ile
 * verilir, adımlar arasında opacity geçişi vardır (CLS üretmez).
 *
 * KURALLAR:
 * - localStorage "emlaksoft:tour-done" → bir kez gösterilir (tur başlar
 *   başlamaz yazılır; yarıda navigasyon olsa da tekrar rahatsız etmez).
 * - /app?tur=1 → daha önce görülmüş olsa bile yeniden başlar (Yardım sayfası
 *   ve kullanıcı menüsündeki "Turu yeniden başlat").
 * - Dar ekranda (telefon) da çalışır: balon ekranın altına sabitlenir.
 * - ?tv=1 (TV modu) ve prefers-reduced-motion'da (yeniden başlatma hariç) hiç başlamaz.
 * - SSR güvenli: yalnız effect sonrası (DOM ölçülebilirken) render edilir.
 * - Bulunamayan / görünmeyen hedefin adımı sessizce atlanır (ör. komut
 *   paleti butonu ya da brifing kartı o an DOM'da yoksa).
 */

const STORAGE_KEY = TOUR_STORAGE_KEY;
const PAD = 8; // delik ile hedef arası nefes payı (px)
const CARD_W = 336; // balon kart genişliği (px)
const CARD_H = 250; // yerleşim hesabı için tahmini kart yüksekliği (px)
const GAP = 12; // delik ile kart arası boşluk (px)

type TourStep = { selector: string; title: string; desc: string; descMobile?: string };

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="brifing"]',
    title: "Bugünkü işleriniz",
    desc: "Bugün yapmanız gereken randevular, görevler ve aranacak müşteriler burada özetlenir.",
  },
  {
    selector: '[data-tour="kpi"]',
    title: "Ofisinizin rakamları",
    desc: "Müşteri, talep ve komisyon sayılarını görürsünüz. Bir rakama dokunursanız o kayıtların listesi açılır.",
  },
  {
    selector: '[data-tour="aksiyonlar"]',
    title: "Görevleriniz",
    desc: "Bir kaydı açıp görevi tamamlayabilir veya müşteriyi arayabilirsiniz.",
  },
  {
    selector: '[data-tour="arama"]',
    title: "Arama kutusu",
    desc: "Müşteri adı, ilan numarası veya görev yazın; hepsi tek kutudan bulunur. Bilgisayarda Ctrl+K kısayolu da açar.",
    descMobile: "Üstteki Arama simgesine dokunun; müşteri adı, ilan numarası veya görev yazın, hepsi tek kutudan bulunur.",
  },
  {
    selector: "aside",
    title: "Menü",
    desc: "Tüm sayfalar solda başlıklar altında durur. Yalnızca yetkiniz olan sayfalar görünür.",
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
  const [mobile, setMobile] = useState(false);

  // Başlatma koşulları — yalnız effect'te (SSR güvenli)
  useEffect(() => {
    let done = false;
    const params = new URLSearchParams(window.location.search);
    const forced = params.get(TOUR_PARAM) === "1";
    if (params.get("tv") === "1") return;
    if (!forced) {
      try {
        done = Boolean(window.localStorage.getItem(STORAGE_KEY));
      } catch {
        return; // localStorage yoksa "bir kez" garantisi verilemez → hiç gösterme
      }
      if (done) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    }

    // Giriş animasyonları otursun, sayfa ölçülebilir olsun
    const t = window.setTimeout(() => {
      const found = STEPS.filter((s) => findTarget(s.selector));
      if (found.length === 0) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* yazılamazsa yine de bu oturumda göster */
      }
      if (forced) {
        // Adres çubuğunda ?tur=1 kalmasın: sayfa yenilenince tur tekrar açılmasın.
        params.delete(TOUR_PARAM);
        const qs = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
      }
      setMobile(window.innerWidth < 768);
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
    el.scrollIntoView({ block: mobile ? "start" : "center", behavior: "smooth" });
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
  }, [phase, index, activeSteps, mobile]);

  if (phase === "idle" || phase === "off") return null;

  // ---- Bitiş ekranı: delik yok, ortalanmış kart ----
  if (phase === "final") {
    return (
      <Dialog open onOpenChange={(nextOpen) => !nextOpen && close()}>
        <DialogFullscreenContent
          overlayClassName="bg-[rgba(7,26,56,0.55)] backdrop-blur-none"
          className="grid place-items-center bg-transparent p-4"
        >
        <div
          className="popover-in w-full max-w-sm rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--elev-5)]"
        >
          <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <DialogTitle asChild>
            <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Hazırsınız!</h2>
          </DialogTitle>
          <DialogDescription asChild>
            <p className="mt-1 text-sm text-text-muted">
              Tur bitti. Takıldığınızda soldaki menüden Yardım ve Destek sayfasını açın; turu oradan istediğiniz zaman yeniden başlatabilirsiniz.
            </p>
          </DialogDescription>
          <button
            type="button"
            onClick={close}
            className="focus-ring press mt-4 min-h-11 w-full rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700"
          >
            Başla
          </button>
        </div>
        </DialogFullscreenContent>
      </Dialog>
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
  if (mobile) {
    // Telefon: balon ekranın altına sabit, tam genişlik
    cardTop = Math.max(16, vh - CARD_H - 16);
    cardLeft = 16;
  } else if (vh - holeBottom >= CARD_H + GAP + 8) {
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
  cardLeft = mobile ? 16 : Math.max(16, Math.min(cardLeft, vw - CARD_W - 16));
  cardTop = Math.max(16, cardTop);

  return (
    <Dialog open onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogFullscreenContent
        overlayClassName="bg-transparent backdrop-blur-none"
        className="overflow-visible bg-transparent"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            next();
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            prev();
          }
        }}
      >
      {/* Spotlight deliği — dev box-shadow geri kalanı karartır. Konum yalnız
          transform ile verilir (layout-shift sayılmaz); adım başına yeniden
          bağlanır (key) ve opacity ile belirir, top/left/width/height animasyonu yok. */}
      <div
        key={`hole-${index}`}
        className="tour-fade absolute left-0 top-0 rounded-[var(--radius-panel)]"
        style={{
          transform: `translate(${hole.left}px, ${hole.top}px)`,
          width: hole.width,
          height: hole.height,
          boxShadow: "0 0 0 2px rgba(255,255,255,0.85), 0 0 0 9999px rgba(7,26,56,0.55)",
        }}
      />
      {/* Balon kart */}
      <div
        key={`card-${index}`}
        className="tour-fade absolute left-0 top-0 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--elev-5)]"
        style={{ transform: `translate(${cardLeft}px, ${cardTop}px)`, width: mobile ? vw - 32 : CARD_W, maxWidth: "calc(100vw - 32px)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold tabular-nums text-brand-600">
            Adım {index + 1} / {activeSteps.length}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Turu kapat"
            className="focus-ring -mr-2 -mt-2 grid h-11 w-11 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-canvas hover:text-ink-950"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <DialogTitle asChild>
          <h2 className="mt-2 font-display text-base font-bold text-ink-950">{step.title}</h2>
        </DialogTitle>
        <DialogDescription asChild>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">{mobile && step.descMobile ? step.descMobile : step.desc}</p>
        </DialogDescription>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={close}
            className="focus-ring min-h-11 rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold text-text-muted transition hover:text-ink-950"
          >
            Geç
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={prev}
              disabled={index === 0}
              className="focus-ring press inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-1.5 text-sm font-semibold text-ink-950 transition hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Geri
            </button>
            <button
              type="button"
              onClick={next}
              className="focus-ring press inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] bg-brand-600 px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-brand-700"
            >
              {index + 1 >= activeSteps.length ? "Bitir" : "İleri"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
      </DialogFullscreenContent>
    </Dialog>
  );
}
