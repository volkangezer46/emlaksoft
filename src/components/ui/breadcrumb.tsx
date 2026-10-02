import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = { label: string; href?: string };

/** Son öğe geçerli sayfadır: bağlantısız ve aria-current="page". */
export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Konum" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="rounded-sm transition-colors hover:text-text focus-ring">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn(last && "font-medium text-text")}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight className="h-3 w-3 text-text-faint" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
