import Link from "@/components/ui/smart-link";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = { label: string; href?: string };

/**
 * Son öğe geçerli sayfadır: bağlantısız ve aria-current="page". `home` verilirse başa ev
 * ikonlu bağlantı eklenir (üst çubuk konum şeridi; erişilebilir adı `home.label`).
 */
export function Breadcrumb({
  items,
  className,
  home,
}: {
  items: BreadcrumbItem[];
  className?: string;
  home?: { href: string; label: string };
}) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Konum" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
        {home ? (
          <li className="flex items-center gap-1">
            <Link
              href={home.href}
              aria-label={home.label}
              title={home.label}
              className="focus-ring grid h-7 w-7 place-items-center rounded-full border border-hairline bg-surface-raised text-text-muted transition-colors hover:text-text"
            >
              <Home className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <ChevronRight className="h-3 w-3 text-text-faint" aria-hidden />
          </li>
        ) : null}
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="rounded-sm transition-colors hover:text-text focus-ring">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn(last && "font-semibold text-text")}>
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
