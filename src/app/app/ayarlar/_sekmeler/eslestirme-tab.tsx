import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Crosshair } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { sanitizeMatchingWeights, type MatchingWeights } from "@/lib/matching-weights";
import { MatchingWeightsForm } from "../matching-weights-form";
import { ReadOnlyGate } from "../read-only-gate";

/** Sekme: Eşleştirme ağırlıkları (`#eslestirme-agirliklari` çapası burada). */
export async function EslestirmeTab({ canEdit }: { canEdit: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("matching_weights").limit(1).maybeSingle();
  const raw = (data as { matching_weights?: unknown } | null)?.matching_weights ?? null;
  const matchingWeights: MatchingWeights | null = raw ? sanitizeMatchingWeights(raw) : null;
  return (
    <section id="eslestirme-agirliklari" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-cyan-400/12 text-cyan-500"><Crosshair className="h-5 w-5" /></span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Eşleştirme ağırlıkları</h2>
            <p className="text-xs text-text-muted">
              Talep × portföy skorunda hangi kriterin ne kadar önemli olduğunu ofisinize göre ayarlayın.
              {matchingWeights ? " Özel ağırlık seti aktif." : " Varsayılan set kullanılıyor."}
            </p>
          </div>
        </div>
        <Link href="/app/talepler?sekme=eslesme" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
          Eşleştirme sayfası <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ReadOnlyGate canEdit={canEdit}>
        <MatchingWeightsForm initial={matchingWeights} />
      </ReadOnlyGate>
    </section>
  );
}
