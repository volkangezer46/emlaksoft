import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tablo primitive'leri — panel genelindeki tablo görünümünün tek kaynağı.
 *
 * Bilinçli olarak "use client" YOK: bunlar saf sunum bileşenleri, dolayısıyla
 * Server Component sayfalarda sıfır JS ile render olurlar. Etkileşim gerektiren
 * kısımlar (sıralama, arama, sayfalama) ayrı client bileşenlerinde durur —
 * bkz. `data-table.tsx` ve `SortableTh`.
 *
 *   <TableFrame minWidth={760}>
 *     <Table>
 *       <THead><TR><TH>Müşteri</TH><TH align="right">Tutar</TH></TR></THead>
 *       <TBody>
 *         <TR><TD>Ahmet</TD><TD align="right">1.200 ₺</TD></TR>
 *       </TBody>
 *     </Table>
 *   </TableFrame>
 */

/** Kart çerçevesi + yatay kaydırma kabı. Tablolar mobilde sayfayı kaydırmaz. */
export function TableFrame({
  children,
  className,
  minWidth,
  maxHeight,
  density = "rahat",
  stickyFirst = false,
  stack = false,
}: {
  children: ReactNode;
  /** Yatay kaydırmada ilk sütun (kimlik) sabit kalır — dar ekranda bağlam kaybolmaz. */
  stickyFirst?: boolean;
  className?: string;
  /** "kompakt": satır dikey boşluğu azalır (liste yoğunluk anahtarı, ?yogunluk=kompakt). */
  density?: "rahat" | "kompakt";
  /** İçerik bu genişliğin altına sıkışmaz; kap yatay kaydırılır. */
  minWidth?: number;
  /** Verilirse kap dikey kayar ve `THead sticky` başlık bu kapta yapışır (ör. "70vh"). */
  maxHeight?: string;
  /** 360 px'te satırlar karta döner (başlık gizlenir, `TD label` hücre önünde yazılır; list-page.css `.tbl-stack`). */
  stack?: boolean;
}) {
  return (
    <div
      className={cn(
        // min-w-0 + max-w-full + contain:inline-size: iç tablo min-content
        // genişliğine büyüyüp mobilde layout viewport'unu (ICB) şişiremez.
        // `contain:inline-size`, kabın kendi genişliğinin içeriğe bağlı olmadığını
        // tarayıcıya söyler → iç overflow-x-auto belgeyi yatay kaydırılabilir
        // yapmaz (WebKit/iOS Safari dahil; `overflow:clip` orada belge-kaydırmasını
        // durdurmuyordu).
        "surface-card w-full min-w-0 max-w-full [contain:inline-size] overflow-hidden rounded-[var(--radius-panel)]",
        density === "kompakt" && "[&_td]:py-1.5 [&_th]:py-1.5",
        stickyFirst && "tbl-sticky-first",
        stack && "tbl-stack",
        className,
      )}
    >
      <div
        className={cn("relative w-full max-w-full [contain:inline-size] overflow-x-auto", maxHeight && "overflow-y-auto")}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {/* İç kap `w-max` (width:max-content) — tablonun DOĞAL genişliğine büyür,
            böylece overflow-x-auto kabının düzgün "oversized" çocuğu olur ve tablo
            İÇTE kaydırılır. Önceki `min-w-full` div'i viewport'ta (356px) kalıyor,
            tablo onu `overflow:visible` ile taşırıp iOS'ta ICB'yi şişiriyor ve TÜM
            sayfayı yatay kaydırılabilir yapıyordu (fixed alt-nav sabit kalsa da
            sayfa yana kayıyordu). sm+ okunabilirlik için min-width tabanı korunur. */}
        <div
          // `[&>table]:min-w-full`: `w-max` kabı içinde `w-full` tablo max-content'e
          // çözülüp kolonları sola yığıyordu; min-width kabın (çerçeve) genişliğine bağlanır.
          className={
            minWidth
              ? "w-max min-w-full sm:[min-width:max(100%,var(--tbl-mw))] [&>table]:min-w-full"
              : "w-max min-w-full [&>table]:min-w-full"
          }
          style={minWidth ? ({ ["--tbl-mw"]: `${minWidth}px` } as CSSProperties) : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table {...props} className={cn("w-full text-left text-sm", className)} />;
}

export function THead({
  className,
  sticky = false,
  ...props
}: ComponentProps<"thead"> & {
  /** Başlık, `TableFrame maxHeight` kabında yukarıda yapışır (opak zemin). */
  sticky?: boolean;
}) {
  return (
    <thead
      {...props}
      className={cn(
        sticky && "sticky top-0 z-10 bg-surface",
        // Başlık satırı: saç teli alt kenar + hafif gömülü zemin.
        // Kalın `border-line` çizgisi tabloyu ağırlaştırıyordu.
        "hairline-b bg-canvas/70 text-xs font-semibold uppercase tracking-[0.04em] text-text-faint",
        className,
      )}
    />
  );
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody {...props} className={className} />;
}

export function TFoot({ className, ...props }: ComponentProps<"tfoot">) {
  return (
    <tfoot
      {...props}
      className={cn("border-t border-line bg-canvas/60 font-semibold text-ink-950", className)}
    />
  );
}

export function TR({
  className,
  interactive = false,
  ...props
}: ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      {...props}
      className={cn(
        "hairline-b transition-colors last:border-0",
        // Hover'da yalnızca zemin değil, sol kenarda ince marka vurgusu:
        // gözün "hangi satırdayım" sorusunu anında cevaplar. Zemin rol token'ından
        // (--surface-hover): açık/koyu ve her yüzeyde aynı formül.
        interactive &&
          "group relative cursor-pointer hover:bg-surface-hover hover:shadow-[inset_2px_0_0_0_var(--brand-500)]",
        className,
      )}
    />
  );
}

const alignClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

export function TH({
  className,
  align = "left",
  ...props
}: Omit<ComponentProps<"th">, "align"> & { align?: keyof typeof alignClass }) {
  return (
    <th
      scope="col"
      {...props}
      className={cn(
        // Mobilde başlık sarar (dar viewport'ta kolon genişliğini zorlamasın),
        // sm+ tek satır. Böylece mobilde tablo yatay kaydırmayı minimuma indirir.
        "whitespace-normal px-4 py-2.5 sm:whitespace-nowrap",
        alignClass[align],
        // Sağa hizalı başlık = sayısal kolon; rakam hizalamasını burada da aç
        align === "right" && "numeric",
        className,
      )}
    />
  );
}

export function TD({
  className,
  align = "left",
  truncate = false,
  label,
  actions = false,
  primary = false,
  ...props
}: Omit<ComponentProps<"td">, "align"> & {
  align?: keyof typeof alignClass;
  /** Uzun metni tek satırda kırpar; metin çocuksa tam değer `title` olarak eklenir. */
  truncate?: boolean;
  /** Kart görünümünde (TableFrame `stack`) hücre önündeki sütun adı. */
  label?: string;
  /** Kart görünümünde eylem hücresi tam satır. */
  actions?: boolean;
  /** Kart görünümünde kartın başlığı (kalın, satırın geri kalanını kaplar). */
  primary?: boolean;
}) {
  const title =
    truncate && props.title === undefined && typeof props.children === "string" ? props.children : props.title;
  return (
    <td
      {...props}
      data-label={label}
      data-actions={actions ? "" : undefined}
      data-primary={primary ? "" : undefined}
      title={title}
      className={cn(
        "px-4 py-3",
        truncate && "td-truncate",
        alignClass[align],
        // Tablolarda sağa hizalama fiilen "sayı" demektir. tabular-nums'u
        // otomatik açıyoruz; tutar kolonları böylece kuruş kuruşa hizalanır.
        align === "right" && "numeric",
        className,
      )}
    />
  );
}

/** Tablo içinde satır kaplayan boş durum hücresi. */
export function TableEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center text-sm text-text-muted">
        {children}
      </td>
    </tr>
  );
}
