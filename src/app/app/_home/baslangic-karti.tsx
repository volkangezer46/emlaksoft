import Link from "@/components/ui/smart-link";
import { cookies } from "next/headers";
import { ArrowRight, Circle, FlaskConical, Rocket } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { ICONS } from "@/lib/icons";
import { DEMO_SEED_FAILED_COOKIE } from "@/lib/sample-registration-seed";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import { OrnekVeriYenile } from "./ornek-veri-yenile";
import { SampleSeedButton } from "./sample-seed-button";
import { afterFirstScreen, loadEmptyProbe, type HomeCtx } from "./data";

const R = 26;
const C = 2 * Math.PI * R;
const MAX_STEP_CHIPS = 4;
const MAX_TASKS = 3;

/**
 * TEK "Başlangıç" kartı, TEK ilerleme halkası (tek Kurulum sihirbazı, `lib/onboarding-steps` kaydı). Eksik varken kısa:
 *  1) Kurulum halkası + sıradaki adım + eksik adım bağlantıları (şirket/profil ayrıntısı göstermez),
 *  2) "İlk işler" kontrol listesi (veri getir, ilk portföy, talep, randevu, tanımlar; sihirbaz adımı değil),
 *  3) Örnek veri durumu (kayıtta yüklenemediyse "yeniden dene", yüklüyse "gerçek kullanıma geç"),
 *  4) Boş ofiste müşteri/portföy ekle.
 * Hepsi tamamlanınca kart HİÇ çizilmez.
 */
export async function BaslangicKarti({ ctx }: { ctx: HomeCtx }) {
  if (ctx.tvMode || !ctx.tenantId) return null;
  // Önce sayım (ısıtılmış, tek tur): dolu ofiste kurulum özeti ikincil kalır ve ilk ekran bitince okunur; boş ofiste hemen.
  const [probe, jar] = await Promise.all([loadEmptyProbe(ctx), cookies()]);
  if (probe && (probe.customers > 0 || probe.properties > 0)) await afterFirstScreen(ctx);
  const snap = await loadOnboardingSnapshot(ctx.tenantId);
  if (!snap) return null;

  const canSettings = (ctx.perms.settings ?? []).includes("edit");
  const seeded = Boolean(snap.tenant?.sample_seeded_at);
  const showRetry = ctx.isManagement && jar.get(DEMO_SEED_FAILED_COOKIE)?.value === "1" && !seeded;
  const showSampleLive = !showRetry && canSettings && snap.counts.sampleCustomers > 0;
  const isEmpty = Boolean(probe && probe.customers === 0 && probe.properties === 0);
  const { state } = snap;
  const nextStep = state.steps.find((s) => s.id === state.nextId) ?? null;
  const pendingSteps = state.steps.filter((s) => !s.done && !snap.skipped.includes(s.id)).slice(0, MAX_STEP_CHIPS);
  const tasks = snap.firstTasks.filter((t) => !t.done).slice(0, MAX_TASKS);
  const showWizard = !state.settled;

  if (!showWizard && !showRetry && !showSampleLive && tasks.length === 0 && !isEmpty) return null;

  const offset = C * (1 - state.percent / 100);

  return (
    <section aria-label="Başlangıç" className="pm-bx flex flex-col gap-4 border border-brand-300/60 bg-brand-600/[0.03] p-4 sm:p-5">
      {showWizard ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex items-center gap-3 sm:min-w-0 sm:flex-1">
            <div className="relative grid h-[60px] w-[60px] shrink-0 place-items-center" role="img" aria-label={`Kurulum %${state.percent} tamam`}>
              <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
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
              <span className="absolute text-sm font-bold tabular-nums text-ink-950">%{state.percent}</span>
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-ink-950">Kurulumunu tamamla</h2>
              <p className="text-xs text-text-muted">
                {state.doneCount}/{state.total} adım tamam{nextStep ? ` · sırada: ${nextStep.short}` : ""}
              </p>
            </div>
          </div>
          <ButtonLink href={`/app/baslangic?adim=${state.nextId ?? ""}`} size="sm" iconRight={ArrowRight} className="shrink-0">
            Devam et
          </ButtonLink>
        </div>
      ) : (
        <header className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
            <Rocket className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-bold text-ink-950">Başlangıç</h2>
            <p className="text-xs text-text-muted">
              {isEmpty
                ? "Ofisin henüz boş. İlk kaydı ekle; görevler, randevular ve grafikler veri geldikçe bu ekranda belirir."
                : "Kurulum tamam. Kalan ilk işleri bitirdikçe bu kart kaybolur."}
            </p>
          </div>
        </header>
      )}

      {showRetry ? <OrnekVeriYenile /> : null}

      {showWizard && pendingSteps.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Eksik kurulum adımları">
          {pendingSteps.map((s) => (
            <li key={s.id}>
              <Link
                href={`/app/baslangic?adim=${s.id}`}
                className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-ink-950"
              >
                <Circle className="h-3 w-3 text-text-faint" aria-hidden="true" />
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {showSampleLive ? (
        <Link
          href="/app/ayarlar/gercek-kullanim"
          className="focus-ring flex min-h-11 flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2 text-sm transition hover:border-brand-300"
        >
          <FlaskConical className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span className="font-semibold text-ink-950">Örnek veri yüklü ({snap.counts.sampleCustomers} örnek müşteri)</span>
          <span className="ml-auto text-xs font-semibold text-brand-600">Örnekleri sil, gerçek kullanıma geç</span>
        </Link>
      ) : null}

      {tasks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-text-muted">İlk işler</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.href}
                  className="focus-ring flex min-h-11 flex-col justify-center rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2 transition hover:border-brand-300"
                >
                  <span className="text-sm font-semibold text-ink-950">{t.title}</span>
                  <span className="line-clamp-1 text-xs text-text-muted">{t.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/app/musteriler/yeni" icon={ICONS.musteri}>
            Müşteri ekle
          </ButtonLink>
          <ButtonLink href="/app/portfoyler/yeni" variant="secondary" icon={ICONS.portfoy}>
            Portföy ekle
          </ButtonLink>
          {seeded || showRetry ? null : <SampleSeedButton />}
          <Link
            href="/app/ice-aktarma"
            className="focus-ring inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Kendi verini içe aktar <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
