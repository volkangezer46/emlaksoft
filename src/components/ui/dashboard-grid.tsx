import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Dashboard yerleşim sistemi (tek kalıp).
 *
 * - `DashboardGrid`: 12 kolonlu ızgara. Mobil 1 kolon, md (768) 6 kolon, xl (1280) ve 2xl (1536) 12 kolon.
 *   Boşluk ölçeği sabit: kartlar arası `gap-4`, bölüm aralığı `DashboardStack` ile `gap-5`.
 *   BOŞ HÜCRE YOK: doğrudan `DashCell` çocuklarının span'ları her kırılımda `fillRowSpans` ile satırı
 *   tamamlayacak şekilde genişletilir (ör. md'de 3+3+3 → 3+3+6; xl'de tek kalan 7 → 12).
 * - `DashCell`: bir ızgara hücresi. `span` md, xl ve isteğe bağlı 2xl kolon sayısını verir; hücrenin ilk
 *   çocuğu hücre yüksekliğini doldurur (aynı satırdaki kartlar aynı boyda biter).
 * - `SectionHeader`: kart/bölüm başlığı + eylem yuvası. Tüm dashboard kartları aynı başlığı kullanır.
 * - `KpiGrid`: TEK KPI ızgarası (ui/kpi-card ve StatRow da bunu kullanır). Esnek satır (flex-wrap): her
 *   satır TAM dolar, satır sonunda yarım/boş hücre kalmaz; son satırdaki kartlar eşit genişleyerek satırı
 *   doldurur (7 → 4+3, 5 → 3+2, mobilde 2 sütun, tek kalan kart tam genişlik). Sütun sayısı öğe sayısına
 *   göre (`kpiFlowCols`); boşluk tek token (`--kpi-gap`); aynı satırdaki kartlar eşit yükseklik.
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

const XXL_SPAN: Record<number, string> = {
  1: "2xl:col-span-1",
  2: "2xl:col-span-2",
  3: "2xl:col-span-3",
  4: "2xl:col-span-4",
  5: "2xl:col-span-5",
  6: "2xl:col-span-6",
  7: "2xl:col-span-7",
  8: "2xl:col-span-8",
  9: "2xl:col-span-9",
  10: "2xl:col-span-10",
  11: "2xl:col-span-11",
  12: "2xl:col-span-12",
};

type CellSpan = { md?: 1 | 2 | 3 | 4 | 5 | 6; xl?: Span; xxl?: Span };

/**
 * Satır tamamlama (saf): CSS ızgarasının otomatik yerleşimiyle aynı açgözlü satır kırımı; bir öğe sığmayınca
 * satır kapanır ve o satırın SON öğesi kalan kolonları alır. Son satır da aynı kuralla tamamlanır.
 * Böylece hiçbir satırın sonunda boş hücre kalmaz (ör. [3,3,3]@6 → [3,3,6]; [7]@12 → [12]; [4,4,4,4]@12 → [4,4,4,12]).
 */
export function fillRowSpans(spans: readonly number[], cols: number): number[] {
  const out = spans.map((n) => Math.min(Math.max(1, n), cols));
  let rowStart = 0;
  let used = 0;
  for (let i = 0; i < out.length; i++) {
    if (used + out[i] > cols) {
      out[i - 1] += cols - used;
      rowStart = i;
      used = 0;
    }
    used += out[i];
  }
  if (out.length > rowStart && used < cols) out[out.length - 1] += cols - used;
  return out;
}

type CellElement = ReactElement<{ span?: CellSpan }>;

function isCell(node: unknown): node is CellElement {
  return isValidElement(node) && node.type === DashCell;
}

export function DashboardGrid({ className, children, ...props }: ComponentProps<"div">) {
  // Yalnız doğrudan DashCell çocukları hesaba girer; başka düğüm varsa (elle yerleşim) dokunulmaz.
  const items = Children.toArray(children);
  const cells = items.length > 0 && items.every(isCell) ? (items as CellElement[]) : null;
  let content: ReactNode = children;
  if (cells) {
    const md = fillRowSpans(cells.map((c) => c.props.span?.md ?? 6), 6);
    const xl = fillRowSpans(cells.map((c) => c.props.span?.xl ?? 12), 12);
    const hasXxl = cells.some((c) => c.props.span?.xxl != null);
    const xxl = hasXxl ? fillRowSpans(cells.map((c) => c.props.span?.xxl ?? c.props.span?.xl ?? 12), 12) : null;
    content = cells.map((c, i) =>
      cloneElement(c, { span: { md: md[i] as CellSpan["md"], xl: xl[i] as Span, ...(xxl ? { xxl: xxl[i] as Span } : {}) } }),
    );
  }
  return (
    <div className={cn("list-stagger grid grid-cols-1 items-stretch gap-4 md:grid-cols-6 xl:grid-cols-12", className)} {...props}>
      {content}
    </div>
  );
}

export function DashCell({
  span = { md: 6, xl: 12 },
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  /** md: 1-6 (6 kolonlu ızgara), xl: 1-12, xxl (2xl, 1536+): 1-12 (verilmezse xl). Varsayılan tam genişlik. */
  span?: CellSpan;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col [&>*]:flex-1",
        MD_SPAN[span.md ?? 6],
        XL_SPAN[span.xl ?? 12],
        span.xxl != null ? XXL_SPAN[span.xxl] : undefined,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Dikey bölüm yığını: dashboard sayfasının ana kabı (bölümler arası --space-5 ≈ 19 px, kurumsal yoğun ölçek). */
export function DashboardStack({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-5", className)} {...props} />;
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

/**
 * KPI esnek ızgarasında satır başına kart sayısı (her kırılım için statik sınıf). Taban 2 (tek kart 1);
 * dar ekranda 2, md'de 3/4, geniş ekranda tek satır. Son satır flex-grow ile dolar (boşluk kalmaz).
 */
export function kpiFlowCols(n: number): string {
  if (n <= 1) return "[--kpi-cols:1]";
  if (n === 2) return "[--kpi-cols:2]";
  if (n === 3) return "[--kpi-cols:2] sm:[--kpi-cols:3]";
  if (n === 4) return "[--kpi-cols:2] xl:[--kpi-cols:4]";
  if (n === 5) return "[--kpi-cols:2] md:[--kpi-cols:3] xl:[--kpi-cols:5]";
  if (n === 6) return "[--kpi-cols:2] md:[--kpi-cols:3] xl:[--kpi-cols:6]";
  return "[--kpi-cols:2] md:[--kpi-cols:4]";
}

export function KpiGrid({
  count,
  className,
  children,
  label = "Özet göstergeler",
  stagger = true,
}: {
  /** Kart sayısı (verilmezse çocuklardan sayılır; boş/false çocuklar sayılmaz). */
  count?: number;
  className?: string;
  children: ReactNode;
  label?: string;
  /** İlk giriş stagger'ı (varsayılan açık). İskelet ızgarasında kapatın. */
  stagger?: boolean;
}) {
  const n = count ?? Children.toArray(children).length;
  return (
    <div role="group" aria-label={label} className={cn("kpi-flow", stagger && "list-stagger", kpiFlowCols(n), className)}>
      {children}
    </div>
  );
}
