"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { isSoftNavigated } from "@/lib/soft-nav";
import { countUpKind, countUpMoneyText, type CountUpFormat } from "./count-up-kind";

/**
 * CountUp — sayı metni (tek sayaç; admin ve odometer adları buna yönlenir). Sunucu çıktısı ve hidrasyon SONUÇ değerini
 * basar (CLS/SEO/JS'siz güvenli).
 *
 * SÖZLEŞME (B028/B051, 2026-10-16; src/components/ui/count-up.test.ts):
 *  - DOM'a ASLA `textContent` yazılmaz: yalnız React'in KENDİ metin düğümünün `nodeValue`'su güncellenir (düğüm kimliği
 *    korunur, React'in sonraki güncellemeleri ekrana yansımaya devam eder).
 *  - Temizlik eski metni geri YAZMAZ: yalnız rAF/IO iptal edilir; animasyon yarıda kesildiyse en güncel metin
 *    (useLayoutEffect ile güncellenen `latest`) geri konur.
 *  - Sunucu değeri çizildiyse (hidrasyon) animasyon oynamaz; para (₺) ve adet (tam sayı) değerlerinde animasyon yok;
 *    menüden gezinmede (data-soft-nav) ve reduced-motion'da yok. İlk sayım yalnız istemcide kurulan (ör. tembel panel)
 *    oran/ondalık değerde, ekrana girince bir kez.
 *  - Değer değişince (realtime/kayıt sonrası tazeleme) eski değerden yeniye ≤200 ms geçiş (para/adet hariç); ASLA 0'dan
 *    başlamaz. Canlı değişen değerler için `ui/animated-number` var.
 *
 * İki kullanım:
 *  - Hazır metin: `value="1.234"` / `"₺1.234"` / `"%12"` (TR binlik, önek/sonek korunur).
 *  - Sayı + biçim: `value={1234} format="money" | "percent" | "number"` (+ decimals, prefix, suffix).
 *    `money` = ₺ tam sayı, `percent` = "%12" (değer zaten yüzde puanı).
 * İlk sayım süresi varsayılanı 700 ms = motion.css `--motion-count`.
 */
export type { CountUpFormat };

/** Değer değişiminde eski → yeni geçiş süresi üst sınırı. */
export const COUNT_UP_CHANGE_MS = 200;

const RE = /^([^\d]*)(\d{1,3}(?:\.\d{3})+|\d+)([^\d.,]*)$/;

function formatNumeric(n: number, format: CountUpFormat, decimals: number): string {
  if (format === "money") return countUpMoneyText(n);
  const body = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  return format === "percent" ? `%${body}` : body;
}

export { countUpKind, type CountUpKind } from "./count-up-kind";

/** Metni hedef sayıya ve biçimleyiciye çevirir; sayı değilse null. */
export function numericOf(
  value: string | number,
  opts: { format?: CountUpFormat; decimals: number; prefix: string; suffix: string },
): { target: number; fmt: (n: number) => string } | null {
  const { format, decimals, prefix, suffix } = opts;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return { target: value, fmt: (n) => prefix + formatNumeric(decimals > 0 ? n : Math.round(n), format ?? "number", decimals) + suffix };
  }
  const m = RE.exec(String(value));
  if (!m) return null;
  const [, pre, digits, post] = m;
  const dotted = digits.includes(".");
  const target = Number(digits.replace(/\./g, ""));
  if (!Number.isFinite(target)) return null;
  return { target, fmt: (n) => prefix + pre + (dotted ? Math.round(n).toLocaleString("tr-TR") : String(Math.round(n))) + post + suffix };
}

/** React'in sahip olduğu metin düğümü yüzeyi (test sahte düğümle sürer). */
export type TextNodeLike = { nodeValue: string | null };

/**
 * Saf animasyon denetleyicisi (DOM'suz; test edilir). Yalnız verilen metin düğümünün `nodeValue`'sunu yazar.
 * `setLatest`: React'in çizdiği en güncel metin (useLayoutEffect'te). `cancel`: animasyon sürüyorsa durdurur ve en güncel
 * metni koyar; sürmüyorsa HİÇBİR ŞEY yazmaz (React'in yazdığı metin ekranda kalır).
 */
export function createCountUpController(deps: { raf: (cb: (t: number) => void) => number; cancelRaf: (id: number) => void }) {
  let rafId = 0;
  let running: TextNodeLike | null = null;
  let latest = "";
  return {
    setLatest(text: string) {
      latest = text;
    },
    latest() {
      return latest;
    },
    running() {
      return running !== null;
    },
    run(node: TextNodeLike, from: number, to: number, fmt: (n: number) => string, ms: number) {
      if (running) this.cancel();
      running = node;
      let start: number | null = null;
      const step = (t: number) => {
        if (running !== node) return;
        if (start === null) start = t;
        const p = ms <= 0 ? 1 : Math.min(1, (t - start) / ms);
        if (p < 1) {
          node.nodeValue = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)));
          rafId = deps.raf(step);
        } else {
          running = null;
          node.nodeValue = latest;
        }
      };
      rafId = deps.raf(step);
    },
    cancel() {
      if (!running) return;
      deps.cancelRaf(rafId);
      const node = running;
      running = null;
      node.nodeValue = latest;
    },
  };
}

/** Elemanın TEK çocuğu olan metin düğümü (React'in doğrudan metin çocuğu); yoksa null (animasyon yapılmaz). */
function ownTextNode(el: HTMLElement | null): Text | null {
  const n = el?.firstChild ?? null;
  return n && n.nodeType === 3 && n === el?.lastChild ? (n as Text) : null;
}

const noopSubscribe = () => () => {};

export function CountUp({
  value,
  format,
  money,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration,
  durationMs,
  className,
}: {
  value: string | number;
  format?: CountUpFormat;
  /** Eski admin adı: `format="money"` ile aynı. */
  money?: boolean;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  /** Eski admin adı: `duration` ile aynı. */
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const ms = duration ?? durationMs ?? 700;
  const fmtKind: CountUpFormat | undefined = money ? "money" : format;
  const numeric = typeof value === "number";
  const text = numeric ? prefix + formatNumeric(value, fmtKind ?? "number", decimals) + suffix : prefix + String(value) + suffix;
  const kind = countUpKind(value, fmtKind, decimals, prefix, suffix);

  // Hidrasyon (sunucu değeri çizildi) mi? Sunucu ve hidrasyon render'ı true, istemcide kurulan bileşen false görür.
  const hydrating = useSyncExternalStore(noopSubscribe, () => false, () => true);
  const serverPainted = useRef<boolean | null>(null);
  const controller = useRef<ReturnType<typeof createCountUpController> | null>(null);
  const shown = useRef<string | null>(null);

  // En güncel metin, pasif efekt temizliklerinden ÖNCE kaydedilir: temizlik eski metni asla geri koymaz.
  useLayoutEffect(() => {
    if (serverPainted.current === null) serverPainted.current = hydrating;
    controller.current ??= createCountUpController({
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (id) => cancelAnimationFrame(id),
    });
    controller.current.setLatest(text);
  }, [text, hydrating]);

  useEffect(() => {
    const c = controller.current;
    const node = ownTextNode(ref.current);
    const prev = shown.current;
    shown.current = text;
    if (!c || !node || kind !== "other") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const parsed = numericOf(value, { format: fmtKind, decimals, prefix, suffix });
    if (!parsed) return;

    if (prev !== null) {
      // Değer değişti: eski değerden yeniye kısa geçiş (0'dan değil).
      if (prev === text) return;
      const from = numericOf(prev.slice(prefix.length, prev.length - suffix.length || undefined), { format: fmtKind, decimals, prefix: "", suffix: "" });
      if (!from || from.target === parsed.target) return;
      c.run(node, from.target, parsed.target, parsed.fmt, Math.min(COUNT_UP_CHANGE_MS, ms));
      return () => c.cancel();
    }

    // İlk kurulum: yalnız istemcide kurulan değer, menü gezinmesi değilse, ekrana girince bir kez.
    if (serverPainted.current || isSoftNavigated() || Math.abs(parsed.target) < 10) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        c.run(node, 0, parsed.target, parsed.fmt, ms);
      },
      { threshold: 0.3 },
    );
    io.observe(ref.current!);
    return () => {
      io.disconnect();
      c.cancel();
    };
  }, [text, ms, kind, value, fmtKind, decimals, prefix, suffix]);

  const cls = [fmtKind || decimals > 0 ? "numeric" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span ref={ref} className={cls || undefined}>
      {text}
    </span>
  );
}
