import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 50;

/** `?sayfa=` parametresini doğrular: 1'den küçük ya da sayı olmayan değer 1'e düşer. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 ? n : 1;
}

/** Supabase `.range()` için [from, to] (0 tabanlı, uçlar dahil). */
export function pageRange(page: number, pageSize = PAGE_SIZE): [number, number] {
  return [(page - 1) * pageSize, page * pageSize - 1];
}

type Props = {
  page: number;
  total: number;
  pageSize?: number;
  /** Sayfa numarasından href üretir — mevcut filtreler çağıran sayfada korunur. */
  hrefFor: (page: number) => string;
};

/**
 * Önceki/Sonraki sayfalama çubuğu (server component, Link tabanlı).
 *
 * Tek sayfa varsa hiç render edilmez — listelerin altında gereksiz bir
 * çubuk durmasın. `total` count:"exact" ile gelmeli; toplam sayfa sayısı
 * ondan türetilir.
 */
export function Pagination({ page, total, pageSize = PAGE_SIZE, hrefFor }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  const btnCls = (disabled: boolean) =>
    `inline-flex items-center gap-1 rounded-[9px] border px-3 py-1.5 text-xs font-semibold transition ${
      disabled
        ? "pointer-events-none border-line text-text-faint opacity-50"
        : "focus-ring press border-line text-ink-950 hover:border-brand-400 hover:text-brand-600"
    }`;

  return (
    <nav
      aria-label="Sayfalama"
      className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-surface px-4 py-2.5"
    >
      <Link
        href={hrefFor(page - 1)}
        aria-disabled={prevDisabled || undefined}
        tabIndex={prevDisabled ? -1 : undefined}
        className={btnCls(prevDisabled)}
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Önceki
      </Link>
      <p className="text-xs text-text-muted">
        Sayfa <strong className="numeric text-ink-950">{page}</strong> /{" "}
        <span className="numeric">{totalPages}</span> ·{" "}
        <span className="numeric">{total.toLocaleString("tr-TR")}</span> kayıt
      </p>
      <Link
        href={hrefFor(page + 1)}
        aria-disabled={nextDisabled || undefined}
        tabIndex={nextDisabled ? -1 : undefined}
        className={btnCls(nextDisabled)}
      >
        Sonraki <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </nav>
  );
}
