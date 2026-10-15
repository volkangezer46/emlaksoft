import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Building2, Crosshair, EyeOff, Presentation, Sparkles } from "lucide-react";
import { tierCls, tierLabel } from "@/lib/matching";
import type { ScoredMatch } from "@/lib/match-candidates";
import { moneyTry } from "@/lib/leak-shield";
import { presentationHref, topPresentableIds } from "@/lib/presentation-prefill";
import { MatchStateBadge } from "../../talepler/match-state-badge";

type Props = {
  /** Skorlanan açık talep sayısı. */
  demandCount: number;
  /** TEK okuyucudan (loadDemandMatches) gelen, skor sırasına dizili ve gizlenenleri ayıklanmış çiftler. */
  pairs: ScoredMatch[];
  /** Açılmış paylaşım bağlantıları ("açıldı" rozeti). */
  openedTokens: ReadonlySet<string>;
  /** Müşteri beğenmedi + "uygun değil" ile gizlenen çift sayısı. */
  hiddenCount: number;
  truncated: boolean;
  /** Müşteri kimliği: "Önerilerle sunum" bağlantısı müşteriyi ön dolgulu taşır (?musteri=). */
  customerId?: string | null;
  nowMs: number;
};

const VISIBLE = 6;

function budgetLabel(min: number | null, max: number | null) {
  if (min != null && max != null) return `${moneyTry(min)} – ${moneyTry(max)}`;
  if (max != null) return `≤ ${moneyTry(max)}`;
  if (min != null) return `≥ ${moneyTry(min)}`;
  return null;
}

/**
 * Müşteri 360 "Eşleşen portföyler": talep detayı ve Eşleşme sekmesiyle AYNI kural (CRM-G3). Aynı portföy birden çok
 * talebe uyuyorsa en iyi skorlu çift gösterilir (portföy tekrar etmez). "Tümünü gör" müşteriye süzülü Eşleşme sekmesini açar.
 */
export function MatchedPropertiesWidget({ demandCount, pairs, openedTokens, hiddenCount, truncated, customerId = null, nowMs }: Props) {
  if (demandCount === 0) return null;

  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    if (seen.has(p.property.id)) return false;
    seen.add(p.property.id);
    return true;
  });
  const top = unique.slice(0, VISIBLE);
  if (top.length === 0 && hiddenCount === 0) return null;

  const presentIds = topPresentableIds(unique);
  const allHref = customerId ? `/app/talepler?sekme=eslesme&customer=${customerId}` : "/app/talepler?sekme=eslesme";

  return (
    <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Sparkles className="h-4 w-4" /> Eşleştirme önerisi
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Eşleşen portföyler</h2>
          <p className="text-xs text-text-muted">
            {demandCount} açık talep · {unique.length} portföy önerisi
            {truncated ? " · yalnız en yeni portföyler tarandı" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {presentIds.length > 0 ? (
            <Link
              href={presentationHref(presentIds, customerId)}
              className="focus-ring inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline touch:min-h-11"
              title="En iyi eşleşen yayındaki portföylerle müşteriye özel sunum hazırla"
            >
              <Presentation className="h-3.5 w-3.5" /> Seçilenlerle sunum ({presentIds.length})
            </Link>
          ) : null}
          <Link
            href={allHref}
            className="focus-ring inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline touch:min-h-11"
          >
            Tümünü gör <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {top.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-text-muted">Şu an gösterilecek yeni öneri yok.</p>
      ) : (
        <div className="divide-y divide-line">
          {top.map((pair) => {
            const budget = budgetLabel(pair.demand.budget_min, pair.demand.budget_max);
            const opened = Boolean(pair.state?.share_token && openedTokens.has(pair.state.share_token));
            return (
              <Link
                key={`${pair.demand.id}-${pair.property.id}`}
                href={`/app/portfoyler/${pair.property.id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-brand-600/[0.02] sm:gap-4 sm:px-5"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                  <Building2 className="h-5 w-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink-950">{pair.property.title ?? pair.property.property_code}</p>
                  <p className="mt-0.5 truncate text-xs text-text-muted">
                    {pair.property.property_code}
                    {pair.property.list_price != null ? ` · ${moneyTry(pair.property.list_price)}` : ""}
                    {budget ? ` · Bütçe: ${budget}` : ""}
                  </p>
                  {pair.state || pair.likedByCustomer ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {pair.likedByCustomer ? (
                        <span className="rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-bold text-mint-600">💚 Müşteri beğendi</span>
                      ) : null}
                      <MatchStateBadge state={pair.state} nowMs={nowMs} opened={opened} />
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-display text-xl font-extrabold text-ink-950">{pair.score}</span>
                  <span className={`hidden rounded-full px-2 py-0.5 text-xs font-bold sm:inline ${tierCls(pair.tier)}`}>
                    {tierLabel(pair.tier)}
                  </span>
                  <Crosshair className="hidden h-4 w-4 text-text-faint sm:block" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {unique.length > VISIBLE || hiddenCount > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-line px-5 py-2">
          {unique.length > VISIBLE ? (
            <Link href={allHref} className="focus-ring inline-flex min-h-9 items-center text-xs font-semibold text-brand-600 hover:underline touch:min-h-11">
              +{unique.length - VISIBLE} portföy daha →
            </Link>
          ) : null}
          {hiddenCount > 0 && customerId ? (
            <Link
              href={`${allHref}&gizlenen=1`}
              className="focus-ring inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-text-muted hover:text-brand-600 touch:min-h-11"
            >
              <EyeOff className="h-3.5 w-3.5" /> {hiddenCount} gizlenen öneri
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
