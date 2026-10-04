import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Dashboard yerleşim sistemi (tek kalıp).
 *
 * - `DashboardGrid`: 12 kolonlu ızgara. Mobil 1 kolon, md (768) 6 kolon, xl (1280) 12 kolon.
 *   Boşluk ölçeği sabit: kartlar arası `gap-4` (16px), bölüm aralığı `DashboardStack` ile `gap-6` (24px).
 * - `DashCell`: bir ızgara hücresi. `span` md ve xl kolon sayısını verir; hücrenin ilk çocuğu
 *   hücre yüksekliğini doldurur (kart yüksekliği eşitleme: aynı satırdaki kartlar aynı boyda biter).
 * - `SectionHeader`: kart/bölüm başlığı + eylem yuvası. Tüm dashboard kartları aynı başlığı kullanır.
 * - `KpiGrid`: KPI kartlarının sütun sayısını öğe sayısına göre seçer; tek başına kalan kart olmaz
 *   (5 öğe: 2→3→5, 6 öğe: 2→3→6, 7/8 öğe: 2→4).
 *
 * Statik Tailwind sınıfları kullanılır (dinamik sınıf adı üretilmez).
 *
 * Hareket: `DashboardGrid` ve `KpiGrid` çocukları ilk girişte `.list-stagger` ile sırayla belirir
 * (motion.css; yalnız transform/opacity, reduced-motion ve TV modunda kapalı). İskelet ızgarasında
 * `stagger={false}` verilir ki gerçek içerik gelince giriş iki kez oynamasın.
 */

type Span = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

const MD_SPAN: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
  5: "md:col-span-5",
  6: "md:col-span-6",
};
const XL_SPAN: Record<number, string> = {
  1: "xl:col-span-1",
  2: "xl:col-span-2",
  3: "xl:col-span-3",
  4: "xl:col-span-4",
  5: "xl:col-span-5",
  6: "xl:col-span-6",
  7: "xl:col-span-7",
  8: "xl:col-span-8",
  9: "xl:col-span-9",
  10: "xl:col-span-10",
  11: "xl:col-span-11",
  12: "xl:col-span-12",
};

export function DashboardGrid({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("list-stagger grid grid-cols-1 items-stretch gap-4 md:grid-cols-6 xl:grid-cols-12", className)}
      {...props}
    />
  );
}

export function DashCell({
  span = { md: 6, xl: 12 },
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  /** md: 1-6 (6 kolonlu ızgara), xl: 1-12. Varsayılan tam genişlik. */
  span?: { md?: 1 | 2 | 3 | 4 | 5 | 6; xl?: Span };
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col [&>*]:flex-1",
        MD_SPAN[span.md ?? 6],
        XL_SPAN[span.xl ?? 12],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Dikey bölüm yığını: dashboard sayfasının ana kabı (bölümler arası 24px). */
export function DashboardStack({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-6", className)} {...props} />;
}

/** Standart bölüm başlığı: sol başlık (+ açıklama), sağ eylem yuvası. */
export function SectionHeader({
  title,
  description,
  eyebrow,
  icon,
  action,
  as: Tag = "h2",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  icon?: ReactNode;
  /** Sağdaki bağlantı/düğme; dar ekranda başlığın altına iner. */
  action?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-1", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="bx-eyebrow mb-0.5">{eyebrow}</p> : null}
        <Tag className="flex items-center gap-2 font-display text-base font-bold leading-6 text-text">
          {icon ? (
            <span aria-hidden="true" className="inline-flex shrink-0 text-text-faint [&>svg]:h-[1.125rem] [&>svg]:w-[1.125rem]">
              {icon}
            </span>
          ) : null}
          <span className="min-w-0">{title}</span>
        </Tag>
        {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 text-sm font-semibold">{action}</div> : null}
    </div>
  );
}

/** Dashboard kartı: tek yüzey reçetesi + standart iç boşluk (p-5) + yükseklik doldurma. */
export function DashCard({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "flex h-full min-w-0 flex-col gap-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--elev-1)] sm:p-5",
        className,
      )}
      {...props}
    />
  );
}

/** Sütun sayısı öğe sayısına göre; yetim (tek başına kalan) kart üretmez. */
export function kpiColumns(n: number): string {
  if (n <= 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-1 sm:grid-cols-2";
  if (n === 3) return "grid-cols-1 sm:grid-cols-3";
  if (n === 4) return "grid-cols-2 xl:grid-cols-4";
  if (n === 5) return "grid-cols-2 md:grid-cols-3 xl:grid-cols-5";
  if (n === 6) return "grid-cols-2 md:grid-cols-3 xl:grid-cols-6";
  return "grid-cols-2 md:grid-cols-4";
}

/**
 * Podyum ızgarası: 1, 2 ya da 3 kişi. Az kişide kartlar sola yığılıp sağda boş alan bırakmaz;
 * ortalanır ve makul genişlikte kalır (3 kişide tam genişlik).
 */
export function podiumColumns(n: number): string {
  if (n <= 1) return "grid-cols-1 sm:mx-auto sm:max-w-xs";
  if (n === 2) return "grid-cols-1 sm:mx-auto sm:max-w-xl sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-3";
}

export function KpiGrid({
  count,
  className,
  children,
  label = "Özet göstergeler",
  stagger = true,
}: {
  /** Çocuk sayısı: sütun düzenini belirler. */
  count: number;
  className?: string;
  children: ReactNode;
  label?: string;
  /** İlk giriş stagger'ı (varsayılan açık). İskelet ızgarasında kapatın. */
  stagger?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn("grid items-stretch gap-3 sm:gap-4", stagger && "list-stagger", kpiColumns(count), className)}>
      {children}
    </div>
  );
}
