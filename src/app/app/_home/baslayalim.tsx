import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowRight, Rocket } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { ButtonLink } from "@/components/ui/button";
import { ICONS } from "@/lib/icons";
import { SampleSeedButton } from "./sample-seed-button";
import { loadEmptyProbe, loadOnboardingState, type HomeCtx } from "./data";

/** Kurulum tamamlanana kadar tepede ince ilerleme şeridi; /app/baslangic'e bağlanır. */
export async function KurulumSeridi({ ctx }: { ctx: HomeCtx }) {
  if (ctx.tvMode) return null;
  const state = await loadOnboardingState(ctx);
  if (!state || state.complete || state.settled) return null;
  const next = state.steps.find((s) => s.id === state.nextId) ?? state.steps.find((s) => !s.done);
  return (
    <Link
      href={`/app/baslangic?adim=${state.nextId}`}
      className="focus-ring pm-bx group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition hover:border-brand-300"
    >
      <span className="text-sm font-bold text-ink-950">Kurulum %{state.percent}</span>
      <Progress value={state.percent} label="Kurulum ilerlemesi" className="min-w-24 flex-1" />
      <span className="min-w-0 truncate text-xs text-text-muted">
        {state.doneCount}/{state.total} adım{next ? ` · Sıradaki: ${next.title}` : ""}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden />
    </Link>
  );
}

/**
 * Veri yokken (müşteri ve portföy 0) sıfır dolu blokları gizler, tek "Başlayalım" kartı gösterir.
 * Veri varsa (ya da TV modunda / sayım okunamazsa) çocukları olduğu gibi akıtır.
 */
export async function BosOfisKapisi({ ctx, children }: { ctx: HomeCtx; children: ReactNode }) {
  if (ctx.tvMode) return <>{children}</>;
  const probe = await loadEmptyProbe(ctx);
  if (!probe || probe.customers > 0 || probe.properties > 0) return <>{children}</>;
  return <Baslayalim />;
}

function Baslayalim() {
  return (
    <section className="pm-bx border border-brand-300/60 bg-brand-600/[0.04] p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <Rocket className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-ink-950">Başlayalım</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Ofisiniz henüz boş. İlk kaydı ekleyin; görevler, randevular ve grafikler veri geldikçe bu ekranda belirir.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <ButtonLink href="/app/musteriler/yeni" icon={ICONS.musteri}>
          Müşteri ekle
        </ButtonLink>
        <ButtonLink href="/app/portfoyler/yeni" variant="secondary" icon={ICONS.portfoy}>
          Portföy ekle
        </ButtonLink>
        <SampleSeedButton />
        <Link
          href="/app/ice-aktarma"
          className="focus-ring inline-flex items-center gap-1 px-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
        >
          Kendi verinizi içe aktarın <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
