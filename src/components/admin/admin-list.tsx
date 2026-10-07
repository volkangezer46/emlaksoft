import Link from "next/link";
import { Info, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Admin liste deseni (kit.css `.adm-*`; docs/DESIGN_SYSTEM.md "Admin liste deseni"). Sunucu bileşenleri, JS yok.
 *  - `AdminListCard`: liste kartı (araç çubuğu + etkin süzgeç satırı + gövde).
 *  - `AdminListSearch`: GET arama formu (diğer süzgeçleri gizli alanla taşır → filtre kontratı).
 *  - `AdminChip`: hızlı süzgeç çipi (bağlantı; `on` = etkin, `count` = gerçek sayı).
 *  - `AdminActiveFilters`: etkin süzgeç çipleri (× ile kaldır) + "Tümünü temizle".
 * Tablo gövdesi `.adm-tbl` (yapışkan başlık, satır vurgusu, 768 px altında kart görünümü; hücre etiketi `data-label`).
 */

export function AdminListCard({ label, toolbar, filters, children, className }: { label: string; toolbar?: ReactNode; filters?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("adm-list", className)} aria-label={label}>
      {toolbar ? <div className="adm-toolbar">{toolbar}</div> : null}
      {filters}
      {children}
    </section>
  );
}

export function AdminListSearch({
  action,
  defaultValue,
  placeholder,
  hidden,
}: {
  action: string;
  defaultValue?: string;
  placeholder: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form className="adm-search" role="search" action={action}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search aria-hidden="true" />
      <input type="search" name="q" defaultValue={defaultValue ?? ""} placeholder={placeholder} aria-label={placeholder} />
    </form>
  );
}

export function AdminChip({ href, on, count, icon, children }: { href: string; on?: boolean; count?: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} className="adm-chip focus-ring" data-on={on ? "1" : undefined} aria-current={on ? "true" : undefined}>
      {icon}
      {children}
      {count !== undefined ? <span className="adm-chip-n">{count}</span> : null}
    </Link>
  );
}

export function AdminInfo({ children }: { children: ReactNode }) {
  return (
    <p className="adm-info">
      <Info aria-hidden="true" />
      {children}
    </p>
  );
}

export function AdminActiveFilters({ chips, clearHref }: { chips: { key: string; label: string; removeHref: string }[]; clearHref: string }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--hairline)] px-4 py-2" aria-label="Etkin süzgeçler">
      <span className="text-xs font-semibold text-text-faint">Süzgeç:</span>
      {chips.map((c) => (
        <Link key={c.key} href={c.removeHref} className="adm-chip focus-ring" data-on="1" aria-label={`${c.label} süzgecini kaldır`}>
          {c.label} <X aria-hidden="true" />
        </Link>
      ))}
      <Link href={clearHref} className="ml-1 text-xs font-semibold text-accent-text hover:underline">
        Tümünü temizle
      </Link>
    </div>
  );
}
