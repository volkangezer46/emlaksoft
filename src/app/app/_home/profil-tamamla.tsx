import Link from "@/components/ui/smart-link";
import { ArrowRight, Circle } from "lucide-react";
import { loadProfileSnapshot } from "@/lib/profile-completion-data";
import { PROFILE_WIZARD_HREF, profileStepHref } from "@/lib/profile-completion";
import type { HomeCtx } from "./data";

const R = 26;
const C = 2 * Math.PI * R;

/**
 * "Ofis profilini tamamla" kartı: kısa kayıtta sorulmayan bilgilerin eksiklerini gösterir. Yalnız ayar yetkisi olanda
 * ve eksik varken çizilir (hepsi tamamsa kart yok). Her eksik madde, sihirbazın ilgili adımına gider (sıfır çıkmaz).
 * Veri `lib/profile-completion-data` (gerçek tenants alanları); TV modunda ve ofissiz oturumda çizilmez.
 */
export async function ProfilTamamla({ ctx }: { ctx: HomeCtx }) {
  if (ctx.tvMode || !ctx.tenantId || !(ctx.perms.settings ?? []).includes("edit")) return null;
  const snap = await loadProfileSnapshot(ctx.tenantId);
  if (!snap || snap.completion.complete) return null;
  const { completion } = snap;
  const offset = C * (1 - completion.percent / 100);
  const shown = completion.missing.slice(0, 8);
  const rest = completion.missing.length - shown.length;

  return (
    <section aria-label="Ofis profilini tamamla" className="pm-bx flex flex-col gap-4 border border-brand-300/60 bg-brand-600/[0.03] p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
      <div className="flex items-center gap-4 sm:w-64 sm:shrink-0">
        <div className="relative grid h-[68px] w-[68px] shrink-0 place-items-center" role="img" aria-label={`Ofis profili %${completion.percent} tamam`}>
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="32" cy="32" r={R} fill="none" strokeWidth="6" className="stroke-line" />
            <circle
              cx="32"
              cy="32"
              r={R}
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={offset}
              className="stroke-brand-600 transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
            />
          </svg>
          <span className="absolute text-sm font-bold tabular-nums text-ink-950">%{completion.percent}</span>
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-ink-950">Ofis profilini tamamla</h2>
          <p className="text-xs text-text-muted">
            {completion.doneCount}/{completion.total} bilgi tamam
          </p>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <ul className="flex flex-wrap gap-1.5" aria-label="Eksik bilgiler">
          {shown.map((m) => (
            <li key={m.id}>
              <Link
                href={profileStepHref(m.step)}
                className="focus-ring inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-ink-950"
              >
                <Circle className="h-3 w-3 text-text-faint" aria-hidden />
                {m.label}
              </Link>
            </li>
          ))}
          {rest > 0 ? (
            <li>
              <Link href={PROFILE_WIZARD_HREF} className="focus-ring inline-flex min-h-9 items-center rounded-full px-2 text-xs font-semibold text-brand-600 hover:underline">
                +{rest} eksik daha
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
      <Link
        href={profileStepHref(completion.nextStep ?? "konum")}
        className="focus-ring group inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        Devam et <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </section>
  );
}
