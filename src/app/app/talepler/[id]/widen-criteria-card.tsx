import Link from "@/components/ui/smart-link";
import { Wand2 } from "lucide-react";
import type { WidenSuggestion } from "@/lib/match-widen";
import { ApplyWidenButton } from "./apply-widen-button";

/**
 * "Kriteri genişlet" kartı (CRM-G6): sıfır ya da az eşleşmeli talepte gerçek skor motorunun aynı aday kümesinde
 * hesapladığı varyantlar ("Üst bütçeyi %10 artırın → +7 portföy"). Kazanılan portföylerden ilk üçü önizleme olarak
 * listelenir; "Uygula" talebi sunucuda yeniden hesaplanan yamayla günceller (yetki: talep düzenleme).
 */
export function WidenCriteriaCard({
  demandId,
  currentCount,
  suggestions,
  canApply,
}: {
  demandId: string;
  currentCount: number;
  suggestions: WidenSuggestion[];
  canApply: boolean;
}) {
  return (
    <section
      id="kriter-genislet"
      aria-labelledby="kriter-genislet-baslik"
      className="rounded-[var(--radius-panel)] border border-cyan-400/35 bg-cyan-400/[0.06] p-4 shadow-[var(--shadow-xs)] sm:p-5"
    >
      <h2 id="kriter-genislet-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Wand2 className="h-4 w-4 text-cyan-600" aria-hidden="true" /> Kriteri genişlet
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        {currentCount === 0 ? "Bu talebe şu an uygun portföy yok." : `Bu talebe şu an ${currentCount} uygun portföy var.`} Aşağıdaki
        değişikliklerden biri, mevcut portföyleriniz içinde yeni eşleşmeler açar.
      </p>
      <ul className="mt-3 space-y-2">
        {suggestions.map((s) => (
          <li key={s.kind} className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-950">{s.label}</p>
                <p className="text-xs font-bold text-mint-600">+{s.gain} portföy · toplam {s.total}</p>
              </div>
              {canApply ? <ApplyWidenButton demandId={demandId} kind={s.kind} gain={s.gain} /> : null}
            </div>
            {s.preview.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {s.preview.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/app/portfoyler/${p.id}`}
                      className="focus-ring inline-flex min-h-8 max-w-[16rem] items-center gap-1 rounded-full border border-line bg-canvas px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-300 hover:text-brand-600 touch:min-h-11"
                    >
                      <span className="truncate">{p.title}</span>
                      <span className="shrink-0 text-text-muted">· {p.score}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {!canApply ? <p className="mt-2 text-xs text-text-muted">Talebi düzenleme yetkiniz olmadığı için öneriyi danışmana iletin.</p> : null}
    </section>
  );
}
