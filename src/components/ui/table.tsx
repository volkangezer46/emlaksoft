import type { ComponentProps, ReactNode } from "react";
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
}: {
  children: ReactNode;
  className?: string;
  /** İçerik bu genişliğin altına sıkışmaz; kap yatay kaydırılır. */
  minWidth?: number;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <div style={minWidth ? { minWidth } : undefined}>{children}</div>
      </div>
    </div>
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table {...props} className={cn("w-full text-left text-sm", className)} />;
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      {...props}
      className={cn("border-b border-line bg-canvas/80 text-text-muted", className)}
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
        "border-b border-line transition last:border-0",
        interactive && "group relative cursor-pointer hover:bg-brand-600/[0.025]",
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
      {...props}
      className={cn("px-4 py-3 font-medium whitespace-nowrap", alignClass[align], className)}
    />
  );
}

export function TD({
  className,
  align = "left",
  ...props
}: Omit<ComponentProps<"td">, "align"> & { align?: keyof typeof alignClass }) {
  return <td {...props} className={cn("px-4 py-3", alignClass[align], className)} />;
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
