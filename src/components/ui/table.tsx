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
  stickyActions = true,
  stack = false,
}: {
  children: ReactNode;
  /** Yatay kaydırmada ilk sütun (kimlik) sabit kalır — dar ekranda bağlam kaybolmaz. */
  stickyFirst?: boolean;
  /**
   * Yatay kaydırmada işlem sütunu (son hücre `TD actions`) sağda yapışık kalır — 768 px tablette 940-1654 px'lik
   * tablolarda işlemler ekran dışında kalmıyor (B141). Yalnız son hücresi `TD actions` olan tablolara etki eder;
   * kart görünümünde (`stack`, <768 px) kapalıdır.
   */
  stickyActions?: boolean;
  className?: string;
  /** "kompakt": satır dikey boşluğu azalır (liste yoğunluk anahtarı, ?yogunluk=kompakt). */
  density?: "rahat" | "kompakt";
  /** İçerik bu genişliğin altına sıkışmaz; kap yatay kaydırılır. */
  minWidth?: number;
  /** Verilirse kap dikey kayar ve `THead sticky` başlık bu kapta yapışır (ör. "70vh"). */
  maxHeight?: string;
  /** 1024 px altında (telefon + tablet) satırlar karta döner (başlık gizlenir, `TD label` hücre önünde yazılır; list-page.css `.tbl-stack`). */
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
        stickyActions && "tbl-sticky-actions",
        stack && "tbl-stack",
        className,
      )}
    >
      {/* `tbl-scroll` (a11y.css): kenar gölgesi kaydırma ipucu (kaydırılacak içerik varken görünür) ve kısa ekranda
          (≤500 px yükseklik) `maxHeight` kalkar — iç dikey kaydırıcı sayfa kaydırmasıyla iç içe geçmez. */}
      <div
        className={cn("tbl-scroll relative w-full max-w-full [contain:inline-size] overflow-x-auto", maxHeight && "overflow-y-auto")}
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

export function Table({
  className,
  srOnly = false,
  ...props
}: ComponentProps<"table"> & {
  /**
   * Yalnız ekran okuyucu için (grafiklerin veri tablosu). Tablo `width:1px`'e küçülemez (min-content'e büyür) ve
   * absolute konumla belgeyi yana taşırırdı (320 px'te /app/raporlar 367 px); bu yüzden `sr-only` bir div'e sarılır.
   */
  srOnly?: boolean;
}) {
  if (srOnly) {
    return (
      <div className="sr-only">
        <table {...props} className={cn("text-left text-sm", className)} />
      </div>
    );
  }
  // `tbl`: satır/hücre varsayılanları (saç teli ayırıcı, hücre dolgusu) tablo düzeyindeki seçicilerden gelir
  // (globals.css) — her satıra/hücreye aynı sınıfı yazmak HTML ve RSC yükünü satır × hücre kadar şişiriyordu (B029).
  return <table {...props} className={cn("tbl w-full text-left text-sm", className)} />;
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
      // Saç teli alt kenar + renk geçişi `.tbl` seçicisinden gelir (globals.css); satır başına sınıf yazılmaz (B029).
      className={cn(
        // Hover'da yalnızca zemin değil, sol kenarda ince marka vurgusu:
        // gözün "hangi satırdayım" sorusunu anında cevaplar. Zemin rol token'ından
        // (--surface-hover): açık/koyu ve her yüzeyde aynı formül. Gölge/cursor `.tbl-row-link` (console-kit.css);
        // `group` group-hover işaretçisi olduğu için sınıf olarak kalır. `hover:bg-surface-hover` BİLEREK yardımcı
        // katmanda: zemin sınıfı veren çağıranlarda (seçili satır, `target:` vurgusu, kendi satırım) eski davranışla
        // aynı şekilde hover zemini kazanır; bileşen katmanına taşınırsa ezilir.
        interactive && "group tbl-row-link hover:bg-surface-hover",
        className,
      ) || undefined}
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
  stackHide = false,
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
  /**
   * Kart görünümünde gizli (`data-stack-hide`). Masaüstünde `hidden xl:table-cell` ile saklanan sütunlar kartta bunu
   * taşımalı: `.tbl-stack td { display: block }` katmansızdır ve Tailwind'in katmanlı `.hidden`'ını ezer.
   */
  stackHide?: boolean;
}) {
  const title =
    truncate && props.title === undefined && typeof props.children === "string" ? props.children : props.title;
  return (
    <td
      {...props}
      // Tanımsız öznitelikler RSC yüküne "$undefined" olarak yazılırdı (satır başına hücre başına ~100 bayt): koşullu yayılır.
      {...(label !== undefined ? { "data-label": label } : null)}
      {...(actions ? { "data-actions": "" } : null)}
      {...(primary ? { "data-primary": "" } : null)}
      {...(stackHide ? { "data-stack-hide": "" } : null)}
      {...(title !== undefined ? { title } : null)}
      // Dolgu (px-4 py-3) `.tbl` seçicisinden gelir (globals.css, components katmanı → çağıranın px-/py- sınıfı ezer);
      // sola hizalama tablodan miras (`text-left`). Varsayılan hücre sınıfsız çizilir (B029: satır × hücre yükü).
      className={
        cn(
          truncate && "td-truncate",
          align !== "left" && alignClass[align],
          // Tablolarda sağa hizalama fiilen "sayı" demektir. tabular-nums'u
          // otomatik açıyoruz; tutar kolonları böylece kuruş kuruşa hizalanır.
          align === "right" && "numeric",
          className,
        ) || undefined
      }
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
