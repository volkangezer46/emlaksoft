import Link from "next/link";
import { ArrowUpRight, Building2, Crosshair, Sparkles } from "lucide-react";
import {
  scoreDemandProperty,
  tierCls,
  tierLabel,
  type MatchDemand,
  type MatchingWeights,
  type MatchProperty,
} from "@/lib/matching";
import { moneyTry } from "@/lib/leak-shield";

type Props = {
  demands: MatchDemand[];
  properties: MatchProperty[];
  /** Ofise özel kriter ağırlıkları — null/tanımsızsa varsayılan set (eski davranış). */
  weights?: MatchingWeights | null;
};

function budgetLabel(min: number | null, max: number | null) {
  if (min != null && max != null) return `${moneyTry(min)} – ${moneyTry(max)}`;
  if (max != null) return `≤ ${moneyTry(max)}`;
  if (min != null) return `≥ ${moneyTry(min)}`;
  return null;
}

export function MatchedPropertiesWidget({ demands, properties, weights }: Props) {
  if (demands.length === 0) return null;

  type Pair = {
    demand: MatchDemand;
    property: MatchProperty;
    score: number;
    tier: ReturnType<typeof scoreDemandProperty>["tier"];
  };

  const pairs: Pair[] = [];
  for (const demand of demands) {
    for (const property of properties) {
      const result = scoreDemandProperty(demand, property, weights);
      if (result.score >= 45) {
        pairs.push({ demand, property, score: result.score, tier: result.tier });
      }
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const top = pairs.slice(0, 6);

  if (top.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <Sparkles className="h-4 w-4" /> Yapay zeka önerisi
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Eşleşen portföyler</h2>
          <p className="text-xs text-text-muted">
            {demands.length} aktif talep · {top.length} portföy önerisi
          </p>
        </div>
        <Link
          href="/app/eslestirme"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
        >
          Tümünü gör <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="divide-y divide-line">
        {top.map((pair) => {
          const budget = budgetLabel(
            pair.demand.budget_min != null ? Number(pair.demand.budget_min) : null,
            pair.demand.budget_max != null ? Number(pair.demand.budget_max) : null,
          );
          return (
            <Link
              key={`${pair.demand.id}-${pair.property.id}`}
              href={`/app/portfoyler/${pair.property.id}`}
              className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-brand-600/[0.02]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
                <Building2 className="h-5 w-5" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink-950">
                  {pair.property.title ?? pair.property.property_code}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {pair.property.property_code}
                  {pair.property.list_price != null
                    ? ` · ${moneyTry(pair.property.list_price)}`
                    : ""}
                  {budget ? ` · Bütçe: ${budget}` : ""}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="font-display text-xl font-extrabold text-ink-950">
                  {pair.score}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tierCls(pair.tier)}`}>
                  {tierLabel(pair.tier)}
                </span>
                <Crosshair className="h-4 w-4 text-text-faint" />
              </div>
            </Link>
          );
        })}
      </div>

      {pairs.length > 6 ? (
        <div className="border-t border-line px-5 py-3 text-center">
          <Link
            href="/app/eslestirme"
            className="text-xs font-semibold text-brand-600 hover:underline"
          >
            +{pairs.length - 6} portföy daha →
          </Link>
        </div>
      ) : null}
    </section>
  );
}
