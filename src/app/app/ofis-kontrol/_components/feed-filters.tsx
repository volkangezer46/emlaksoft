import Link from "@/components/ui/smart-link";
import { FEED_CATEGORIES, feedActionOptions } from "@/lib/oversight/feed";
import { hasFeedFilter, type FeedFilters } from "@/lib/oversight/feed-query";

const CONTROL =
  "rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400";

/** Akis filtreleri: GET formu — URL'e yazilir, sunucu sorgusu ayni degerleri okur. */
export function FeedFiltersForm({
  filters,
  advisors,
  basePath,
  hideActor,
}: {
  filters: FeedFilters;
  advisors: { id: string; name: string }[];
  basePath: string;
  hideActor?: boolean;
}) {
  const actions = feedActionOptions();
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface p-3">
      {hideActor ? null : (
        <select name="aktor" defaultValue={filters.aktor} aria-label="Danışman" className={CONTROL}>
          <option value="">Tüm danışmanlar</option>
          {advisors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <select name="kategori" defaultValue={filters.kategori} aria-label="İşlem grubu" className={CONTROL}>
        <option value="">Tüm işlem grupları</option>
        {FEED_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select name="tur" defaultValue={filters.tur} aria-label="İşlem türü" className={CONTROL}>
        <option value="">Tüm işlemler</option>
        {actions.map((a) => (
          <option key={a.code} value={a.code}>
            {a.label}
          </option>
        ))}
      </select>
      <select name="risk" defaultValue={filters.risk} aria-label="Risk" className={CONTROL}>
        <option value="">Tüm riskler</option>
        <option value="yuksek">Yüksek risk</option>
        <option value="orta">Orta risk</option>
      </select>
      <input name="from" type="date" defaultValue={filters.from} aria-label="Başlangıç tarihi" className={CONTROL} />
      <span className="text-text-faint" aria-hidden>
        —
      </span>
      <input name="to" type="date" defaultValue={filters.to} aria-label="Bitiş tarihi" className={CONTROL} />
      <button type="submit" className="focus-ring press rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
        Filtrele
      </button>
      {hasFeedFilter(filters) ? (
        <Link href={basePath} className="text-xs font-semibold text-text-muted underline-offset-2 hover:text-danger-500 hover:underline">
          Temizle
        </Link>
      ) : null}
    </form>
  );
}
