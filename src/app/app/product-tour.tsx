"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { useClosedModules } from "@/components/app/closed-modules-context";
import {
  Dialog,
  DialogDescription,
  DialogFullscreenContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { now } from "@/lib/clock";
import type { AppModule } from "@/lib/permissions";
import { TOURS, getTour, resolveTourSteps, tourIdForRole, type TourId, type TourStepDef } from "@/lib/product-tour-data";
import { TOUR_PARAM, isTourDone, markTourDone } from "@/lib/product-tour-storage";

/**
 * Rol bazlı ürün turları — ölçümü yerel, modal davranışı ortak Radix altyapısında çalışan spotlight.
 * Turların içeriği TEK veri dosyasındadır: `src/lib/product-tour-data.ts`.
 *
 * NASIL: Hedef elementin getBoundingClientRect'i ölçülür; tam ekran katman içinde hedef boyutunda şeffaf bir
 * "delik" konumlanır ve devasa bir box-shadow geri kalanı karartır. Konum yalnız transform ile verilir,
 * adımlar arasında opacity geçişi vardır (CLS üretmez). Adım başka bir sayfadaysa router ile oraya gidilir;
 * hedef 3 sn içinde görünmezse adım sessizce atlanır.
 *
 * KURALLAR:
 * - Otomatik başlama yalnız ana ekranda, rolün turu daha önce görülmediyse (localStorage, try/catch) ve
 *   prefers-reduced-motion KAPALIYSA olur. Depolama yoksa "bir kez" garantisi verilemez → otomatik başlamaz.
 * - /app?tur=1 → rolün turu; /app?tur=<tur-kimliği> → o tur (Yardım sayfası ve kullanıcı menüsü).
 *   Yeniden başlatma, hareket azaltma açık olsa bile çalışır.
 * - Klavye: sağ/sol ok = ileri/geri, Esc = kapat, düğmeler odaklanabilir. Dar ekranda balon alta sabitlenir.
 * - ?tv=1 ve TV panosunda hiç başlamaz. SSR güvenli: yalnız effect sonrası render edilir.
 */

const PAD = 8; // delik ile hedef arası nefes payı (px)
const CARD_W = 336; // balon kart genişliği (px)
const CARD_H = 250; // yerleşim hesabı için tahmini kart yüksekliği (px)
const GAP = 12; // delik ile kart arası boşluk (px)
const FIND_TRIES = 30; // 30 x 100 ms = 3 sn hedef bekleme

type Rect = { top: number; left: number; width: number; height: number };
type Phase = "idle" | "run" | "final" | "off";

/** Seçicilerden ilk *görünür* elementi döndürür (mobilde gizli aside vb. elenir). */
function findTarget(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) return el;
    }
  }
  return null;
}

export function ProductTour({ role, accessible }: { role: string; accessible: readonly AppModule[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const closed = useClosedModules();
  const [phase, setPhase] = useState<Phase>("idle");
  const [tourId, setTourId] = useState<TourId | null>(null);
  const [steps, setSteps] = useState<TourStepDef[]>([]);
  const [index, setIndex] = useState(0);
  const [measured, setMeasured] = useState<{ index: number; rect: Rect } | null>(null);
  const [mobile, setMobile] = useState(false);
  const dirRef = useRef<1 | -1>(1);

  // Başlatıcıların her render'da yeniden kurulmaması için en güncel bağlam ref'te tutulur.
  const ctxRef = useRef({ role, accessible, closed });
  useEffect(() => {
    ctxRef.current = { role, accessible, closed };
  }, [role, accessible, closed]);

  const begin = useCallback((id: TourId): boolean => {
    const c = ctxRef.current;
    const resolved = resolveTourSteps(id, { accessible: c.accessible, closed: c.closed, role: c.role });
    if (resolved.length === 0) return false;
    markTourDone(id, new Date(now()).toISOString());
    dirRef.current = 1;
    setMobile(window.innerWidth < 768);
    setTourId(id);
    setSteps(resolved);
    setIndex(0);
    setMeasured(null);
    setPhase("run");
    return true;
  }, []);

  // Başlatma koşulları — yalnız effect'te (SSR güvenli)
  useEffect(() => {
    if (phase === "run" || phase === "final" || !role) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tv") === "1" || pathname.startsWith("/app/pano-tv")) return;
    const raw = params.get(TOUR_PARAM);
    let id: TourId;
    if (raw) {
      id = getTour(raw)?.id ?? tourIdForRole(role);
    } else {
      if (pathname !== "/app") return;
      id = tourIdForRole(role);
      if (isTourDone(id) !== false) return; // görüldü ya da depolama yok → rahatsız etme
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    }
    // Giriş animasyonları otursun, sayfa ölçülebilir olsun
    const t = window.setTimeout(() => {
      if (raw) {
        // Adres çubuğunda ?tur=… kalmasın: sayfa yenilenince tur tekrar açılmasın.
        params.delete(TOUR_PARAM);
        const qs = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
      }
      begin(id);
    }, 800);
    return () => window.clearTimeout(t);
  }, [pathname, phase, role, begin]);

  const close = useCallback(() => setPhase("off"), []);

  const next = useCallback(() => {
    dirRef.current = 1;
    setIndex((i) => {
      if (i + 1 >= steps.length) {
        setPhase("final");
        return i;
      }
      return i + 1;
    });
  }, [steps.length]);

  const prev = useCallback(() => {
    dirRef.current = -1;
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Aktif adım: gerekirse sayfaya git, hedefi bekle, ölç; resize/scroll'da pozisyonu güncelle
  useEffect(() => {
    if (phase !== "run") return;
    const step = steps[index];
    if (!step) return;
    let cancelled = false;
    let poll: number | undefined;
    let raf = 0;
    let detach: (() => void) | undefined;

    // Hedef bulunamazsa adımı sessizce atla (geri giderken geriye, yoksa ileriye)
    const skip = () => {
      if (dirRef.current === -1 && index > 0) setIndex(index - 1);
      else if (index + 1 >= steps.length) setPhase("final");
      else {
        dirRef.current = 1;
        setIndex(index + 1);
      }
    };

    const attach = (el: HTMLElement) => {
      el.scrollIntoView({ block: mobile ? "start" : "center", behavior: "smooth" });
      const update = () => {
        const r = el.getBoundingClientRect();
        setMeasured({ index, rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
      };
      update();
      const onMove = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      };
      window.addEventListener("resize", onMove);
      window.addEventListener("scroll", onMove, true);
      detach = () => {
        window.removeEventListener("resize", onMove);
        window.removeEventListener("scroll", onMove, true);
      };
    };

    let tries = 0;
    const look = () => {
      if (cancelled) return;
      const el = findTarget(step.selectors);
      if (el) return attach(el);
      if (++tries > FIND_TRIES) return skip();
      poll = window.setTimeout(look, 100);
    };
    // Sayfa değişimi ve ilk ölçüm mikro-gecikmeyle (react-hooks/set-state-in-effect)
    poll = window.setTimeout(() => {
      if (cancelled) return;
      if (window.location.pathname !== step.path) router.push(step.path);
      look();
    }, 0);

    return () => {
      cancelled = true;
      if (poll !== undefined) window.clearTimeout(poll);
      cancelAnimationFrame(raf);
      detach?.();
    };
  }, [phase, index, steps, mobile, router]);

  if (phase === "idle" || phase === "off") return null;

  // ---- Bitiş ekranı: delik yok, ortalanmış kart ----
  if (phase === "final") {
    const tour = tourId ? getTour(tourId) : null;
    const others = TOURS.filter((t) => t.id !== tourId && resolveTourSteps(t.id, { accessible, closed, role }).length > 0);
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
              {tour ? `${tour.label} bitti. ` : "Tur bitti. "}
              Takıldığınızda soldaki menüden Yardım sayfasını açın; turları oradan istediğiniz zaman yeniden başlatabilirsiniz.
            </p>
          </DialogDescription>
          {others.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Başka turlar">
              {others.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => begin(t.id)}
                  className="focus-ring press min-h-11 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
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
  const step = steps[index];
  const rect = measured && measured.index === index ? measured.rect : null;
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
  const tourLabel = tourId ? (getTour(tourId)?.label ?? "Tur") : "Tur";

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
            {tourLabel} · Adım {index + 1} / {steps.length}
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
        <div
          role="progressbar"
          aria-label="Tur ilerlemesi"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line"
        >
          <div className="h-full origin-left rounded-full bg-brand-600" style={{ transform: `scaleX(${(index + 1) / steps.length})` }} />
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
              {index + 1 >= steps.length ? "Bitir" : "İleri"} <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
      </DialogFullscreenContent>
    </Dialog>
  );
}
