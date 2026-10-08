import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { SCORE_RULE_LABELS } from "@/lib/gamification";
import { loadCoachPlan } from "@/lib/league/coach-load";
import { currentLeaguePeriod } from "@/lib/league/periods";

/**
 * Lig koçu (Performansım): "Bu hafta liderliğe X puan" + en hızlı puan kazandıracak en çok 3 somut eylem.
 * Her eylem kişinin GERÇEK bekleyen kaydından gelir (geciken görev, yanıt bekleyen yeni talep, teyit bekleyen ilan,
 * işaretlenmemiş randevu) ve kayda bağlantı verir. Bekleyen kayıt yoksa eylem çizilmez; hiç lig verisi de yoksa kart yok.
 * Tutar yok (P12): yalnız puan ve adet.
 */
export async function LigKocu({ tenantId, userId }: { tenantId: string | null; userId: string }) {
  if (!tenantId) return null;
  const supabase = await createClient();
  const nowMs = now();
  const plan = await loadCoachPlan(supabase, { tenantId, userId, nowMs });
  if (!plan) return null;

  return (
    <section aria-labelledby="lig-kocu-baslik" data-slot="league-coach" className="ds-card ds-pad no-print">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-400/15 text-amber-700" aria-hidden="true">
            <Trophy className="h-4 w-4" />
          </span>
          <div>
            <h2 id="lig-kocu-baslik" className="font-display text-base font-bold text-text">
              Lig koçu
            </h2>
            <p className="text-xs text-text-muted">{plan.headline}</p>
          </div>
        </div>
        <Link
          href={`/app/lig?donem=${currentLeaguePeriod("week", nowMs)}`}
          className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-accent-text hover:underline"
        >
          Lig tablosu <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </header>

      {plan.actions.length === 0 ? (
        <p className="rounded-[var(--radius-card)] bg-canvas px-3 py-2.5 text-xs text-text-muted">
          Şu an puan getirecek bekleyen bir kaydın yok. Yeni müşteri, gösterim veya portföy ekledikçe puan yazılır.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {plan.actions.map((a) => (
            <li key={a.key} className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={a.href} className="focus-ring rounded text-sm font-bold text-text hover:text-accent-text">
                  {a.title}
                </Link>
                <span className="numeric rounded-full bg-surface-accent-soft px-2 py-0.5 text-xs font-bold text-accent-text">
                  +{a.pointsEach} puan / {SCORE_RULE_LABELS[a.rule].toLocaleLowerCase("tr-TR")} · {a.count} bekliyor
                </span>
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {a.evidence.map((e) => (
                  <li key={e.id}>
                    <Link href={e.href} className="focus-ring rounded text-xs text-text-muted hover:text-accent-text hover:underline">
                      {e.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
