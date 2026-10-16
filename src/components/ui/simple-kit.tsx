"use client";

import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Ellipsis } from "lucide-react";
import { useSimpleMode } from "@/lib/simple-mode";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { KPI_CAP_DESKTOP, KPI_CAP_PHONE } from "@/components/ui/kpi-cap-limits";

/**
 * Sade mod KİT parçaları (sadeleştirme planı 2.1 / 2.5; DENGELİ görünüm, sahip kararı 2026-10-16). Ortak bileşenler
 * (KpiStrip, ListPage, PageHeader, ViewSwitcher, BulkBar) varsayılan görünümdeki davranışı buradan alır; sayfalar ayrıca
 * bayrak okumak zorunda kalmaz. Hiçbir şey SİLİNMEZ; önemli bilgi görünür, ikincil ayrıntı katlanır:
 *  - `SimpleFold`: "Özeti göster" ile açılan katlı bölüm (yalnız GRAFİKLER; yanında tek satır özet). Kapalıyken DOM'da yok.
 *  - `KpiCap`: KPI şeridi GÖRÜNÜR; masaüstünde en çok 6, telefonda 2 kart, kalanı "Tüm göstergeler" ile açılır.
 *  - `SimpleOverflow`: masaüstünde ilk 2 ikincil eylem satır içinde, kalanı "Diğer" (…) menüsünde; telefonda hepsi menüde.
 *  - `SimpleSwap`: sade/tam için önceden çizilmiş iki düğümden birini seçer (sunucu bileşeni ikisini de hazırlar).
 *  - `HelperText`: kısa (tek satırlık) yardım metni görünür, uzun yardım paragrafı katlanır; `SimpleHide`: "Taze" damgası.
 *
 * Kapsam yalnız `/app`: `/admin` kabuğunda sade mod sağlayıcısı yoktur (bağlamın varsayılanı "sade" olduğundan
 * yönetici ekranları yanlışlıkla katlanmasın diye yol denetlenir).
 */
export function useKitSimpleMode(): boolean {
  const simple = useSimpleMode();
  const path = usePathname() ?? "";
  return simple && (path === "/app" || path.startsWith("/app/"));
}

/** İç içe katlı bölüm tek kez katlansın: dıştaki "Özet" açıldıysa içteki KpiStrip doğrudan çizilir. */
const FoldContext = createContext(false);

export function SimpleFold({
  children,
  label = "Özet",
  hint,
  className,
}: {
  children: ReactNode;
  /** Düğme metninde: "Özeti göster" / "Özeti gizle". */
  label?: string;
  /** Kapalı düğmenin yanında tek satır özet (ör. "Durum ve tür dağılımı"): katlı bölümde ne olduğu görünür kalır. */
  hint?: string;
  className?: string;
}) {
  const simple = useKitSimpleMode();
  const nested = useContext(FoldContext);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!simple || nested) return <>{children}</>;
  const word = label === "Özet" ? "Özeti" : label;
  return (
    <div className={cn("simple-fold", className)} data-simple-fold={open ? "open" : "closed"}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="simple-fold-toggle focus-ring press"
      >
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        {open ? `${word} gizle` : `${word} göster`}
        {hint && !open ? <span className="simple-fold-hint">· {hint}</span> : null}
      </button>
      {open ? (
        <FoldContext value={true}>
          <div id={id} className="simple-fold-body">
            {children}
          </div>
        </FoldContext>
      ) : null}
    </div>
  );
}

/** Sade mod için `simple`, tam mod için `full` düğümünü çizer (ikisi de sunucuda hazırlanabilir; DOM'a yalnız biri girer). */
export function SimpleSwap({ simple, full }: { simple: ReactNode; full: ReactNode }) {
  return <>{useKitSimpleMode() ? simple : full}</>;
}

/** Yalnız tam modda çizilir (yardım metni, "Taze" damgası). */
export function SimpleHide({ children }: { children: ReactNode }) {
  return useKitSimpleMode() ? null : <>{children}</>;
}

/** Düğümün düz metin uzunluğu (yalnız metin/sayı çocukları sayılır; bileşen içi bilinmez → 0). */
export function textLength(node: ReactNode): number {
  let n = 0;
  Children.forEach(node, (c) => {
    if (typeof c === "string" || typeof c === "number") n += String(c).length;
    else if (isValidElement(c)) n += textLength((c.props as { children?: ReactNode }).children);
  });
  return n;
}

/** Dengeli görünümde görünür kalan yardım metninin üst sınırı (≈ tek satır). */
export const SHORT_HELP_MAX = 110;

/**
 * Küçük gri yardım metni (`text-xs` soluk). Varsayılan (dengeli) görünümde KISA metin (≤ ~1 satır) görünür, uzun yardım
 * paragrafı katlanır (tam görünümde her zaman görünür). Alanın anlamını taşıyan metin (hata, zorunluluk, birim) için
 * KULLANILMAZ; yalnız "ipucu" niteliğindeki açıklamalar içindir.
 */
export function HelperText({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  if (useKitSimpleMode() && textLength(children) > SHORT_HELP_MAX) return null;
  return (
    <p id={id} className={cn("helper-text text-xs text-text-muted", className)}>
      {children}
    </p>
  );
}

/**
 * "…" taşma menüsü: tetik düğmesi (ikon + görünür kısa etiket) ve altında açılan panel. Panel KAPALIYKEN de bağlı kalır
 * (yalnız `hidden`): içindeki düğmenin açtığı diyalog, menü kapanınca sökülmez. Panel `position: fixed` ile çizilir; üst
 * kapsayıcı `overflow: hidden` (liste başlığı) olsa da kırpılmaz. Dışarı dokunma, Esc, kaydırma ve öğe seçimi kapatır.
 */
export function OverflowMenu({
  children,
  label = "Diğer",
  ariaLabel = "Diğer işlemler",
  className,
  triggerClassName,
}: {
  children: ReactNode;
  /** Tetikte görünen kısa etiket (etiketsiz ikon düğmesi yok). */
  label?: string;
  /** Erişilebilir ad; görünür etiketi İÇERMELİ (ör. "Diğer işlemler"). */
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const open = pos !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setPos(null);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    // Sağ kenara hizalı; dar ekranda sola taşmasın diye en az 8 px pay.
    setPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(vw - r.right)) });
  };

  return (
    <div ref={rootRef} className={cn("ovf relative inline-flex", className)}>
      <Button
        ref={triggerRef}
        variant="outline"
        icon={Ellipsis}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className={cn("ovf-trigger", triggerClassName)}
      >
        {label}
      </Button>
      <div
        id={id}
        role="group"
        aria-label={ariaLabel}
        hidden={!open}
        style={pos ?? undefined}
        className="ovf-panel"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a[href], button")) setPos(null);
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Parça (Fragment) ve dizi çocuklarını düz listeye açar; boş çocuklar atlanır. */
function flattenItems(node: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(node, (c) => {
    if (c === null || c === undefined || typeof c === "boolean" || c === "") return;
    if (isValidElement(c) && c.type === Fragment) out.push(...flattenItems((c.props as { children?: ReactNode }).children));
    else out.push(c);
  });
  return out;
}

/** Dengeli görünümde masaüstünde satır içinde kalan ikincil eylem sayısı. */
export const INLINE_SECONDARY = 2;

/**
 * Başlık ikincil eylemleri. Varsayılan (dengeli) görünümde masaüstünde ilk `inline` (2) eylem birincilin yanında satır
 * içinde, kalanı "Diğer" (…) menüsündedir; telefonda (<640 px) hepsi menüdedir (ekranda tek dolu düğme + "…"). Tam
 * modda satır içinde aynen çizilir. `always`: her modda hepsi menüde. Satır içi eylemin menü kopyası yalnız telefonda
 * görünür (CSS); iki kopyadan aynı anda yalnız biri erişilebilir ağaçtadır.
 */
export function SimpleOverflow({
  children,
  label,
  ariaLabel,
  always = false,
  inline = INLINE_SECONDARY,
}: {
  children: ReactNode;
  label?: string;
  ariaLabel?: string;
  always?: boolean;
  /** Dengeli görünümde masaüstünde satır içinde kalacak eylem sayısı. */
  inline?: number;
}) {
  const simple = useKitSimpleMode();
  if (!simple && !always) return <>{children}</>;
  if (always || inline <= 0) {
    return (
      <OverflowMenu label={label} ariaLabel={ariaLabel}>
        {children}
      </OverflowMenu>
    );
  }
  const items = flattenItems(children);
  const shown = items.slice(0, inline);
  const rest = items.slice(inline);
  return (
    <>
      {shown.map((it, i) => (
        <span key={`i${i}`} className="ovf-inline contents max-sm:hidden">
          {it}
        </span>
      ))}
      {items.length > 0 ? (
        <OverflowMenu label={label} ariaLabel={ariaLabel} className={rest.length === 0 ? "sm:hidden" : undefined}>
          {shown.map((it, i) => (
            <span key={`m${i}`} className="ovf-phone-copy contents sm:hidden">
              {it}
            </span>
          ))}
          {rest.map((it, i) => (
            <Fragment key={`r${i}`}>{it}</Fragment>
          ))}
        </OverflowMenu>
      ) : null}
    </>
  );
}

/**
 * KPI şeridi sınırı (dengeli görünüm): şerit GÖRÜNÜR, masaüstünde en çok 6 kart (`.kpi-more-d` gizli), telefonda 2 kart
 * (`.kpi-more` gizli; premium.css `.kpi-compact`). Kalan kartlar "Tüm göstergeler (n)" ile aynı yerde açılır. Tam modda
 * (ya da /app dışında) sarmalayıcı davranış eklemez.
 */
export function KpiCap({ count, children }: { count: number; children: ReactNode }) {
  const simple = useKitSimpleMode();
  const [open, setOpen] = useState(false);
  if (!simple) return <>{children}</>;
  const desk = count > KPI_CAP_DESKTOP;
  const phone = count > KPI_CAP_PHONE;
  return (
    <div className="kpi-cap" data-kpi-cap={open ? "open" : "closed"}>
      {children}
      {phone || desk ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "kpi-cap-toggle focus-ring press",
            phone ? "max-sm:inline-flex" : "max-sm:hidden",
            desk ? "sm:inline-flex" : "sm:hidden",
          )}
        >
          <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          {open ? "Daha az gösterge" : `Tüm göstergeler (${count})`}
        </button>
      ) : null}
    </div>
  );
}
