"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Ellipsis } from "lucide-react";
import { useSimpleMode } from "@/lib/simple-mode";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Sade mod KİT parçaları (sadeleştirme planı 2.1 / 2.5). Ortak bileşenler (KpiStrip, ListPage, PageHeader, ViewSwitcher,
 * BulkBar) sade moddaki davranışı buradan alır; sayfalar ayrıca bayrak okumak zorunda kalmaz. Hiçbir şey SİLİNMEZ:
 *  - `SimpleFold`: sade modda "Özeti göster" ile açılan katlı bölüm (KPI, grafik). Kapalıyken içerik DOM'a hiç girmez.
 *  - `SimpleOverflow`: sade modda çocuklar "Diğer" (…) menüsüne katlanır; tam modda satır içinde aynen durur.
 *  - `SimpleSwap`: sade/tam için önceden çizilmiş iki düğümden birini seçer (sunucu bileşeni ikisini de hazırlar).
 *  - `HelperText` / `SimpleHide`: küçük gri yardım metni ve "Taze" damgası sade modda gizlenir.
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
  className,
}: {
  children: ReactNode;
  /** Düğme metninde: "Özeti göster" / "Özeti gizle". */
  label?: string;
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

/**
 * Küçük gri yardım metni (`text-xs` soluk): sade modda gizli, tam modda görünür. Alanın anlamını taşıyan metin (hata,
 * zorunluluk, birim) için KULLANILMAZ; yalnız "ipucu" niteliğindeki açıklamalar içindir.
 */
export function HelperText({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  if (useKitSimpleMode()) return null;
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

/**
 * Başlık ikincil eylemleri: sade modda "Diğer" (…) menüsüne katlanır (ekranda tek dolu düğme kalır), tam modda satır
 * içinde aynen çizilir. `always`: her modda menüde.
 */
export function SimpleOverflow({
  children,
  label,
  ariaLabel,
  always = false,
}: {
  children: ReactNode;
  label?: string;
  ariaLabel?: string;
  always?: boolean;
}) {
  const simple = useKitSimpleMode();
  if (!simple && !always) return <>{children}</>;
  return (
    <OverflowMenu label={label} ariaLabel={ariaLabel}>
      {children}
    </OverflowMenu>
  );
}
