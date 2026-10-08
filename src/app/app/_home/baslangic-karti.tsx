import Link from "@/components/ui/smart-link";
import { cookies } from "next/headers";
import { ArrowRight, Circle, FlaskConical, Rocket } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ICONS } from "@/lib/icons";
import { DEMO_SEED_FAILED_COOKIE } from "@/lib/sample-registration-seed";
import { loadOnboardingSnapshot } from "@/lib/onboarding-state";
import { PROFILE_WIZARD_HREF, profileStepHref } from "@/lib/profile-completion";
import { OrnekVeriYenile } from "./ornek-veri-yenile";
import { SampleSeedButton } from "./sample-seed-button";
import { loadEmptyProbe, type HomeCtx } from "./data";

const R = 26;
const C = 2 * Math.PI * R;
const MAX_CHIPS = 4;
const MAX_STEPS = 3;

/**
 * TEK "Başlangıç" kartı: eskiden altı ayrı parça (kurulum şeridi, profil tamamla, örnek veri yenile bandı, boş ofis
 * "Başlayalım" kartı...) ana ekranın tepesinde üst üste biniyordu. Şimdi tek kart, üç bölüm:
 *  1) Ofis profili (ilerleme halkası + eksik maddeler; `lib/profile-completion`, yalnız ayar yetkisi olanda),
 *  2) Örnek veri durumu (kayıtta yüklenemediyse "yeniden dene", yüklüyse "gerçek kullanıma geç"),
 *  3) İlk adımlar (kurulum sihirbazının sıradaki adımları; boş ofiste müşteri/portföy ekle).
 * Hepsi tamamlanınca kart HİÇ çizilmez. İlerleme modeli TEK: kurulumun "Ofis" adımı da profil-tamamlamadan türer
 * (`isOfficeProfileDone`), bu yüzden o adım ile ekip adımı profil bölümü görünürken "ilk adımlar"da tekrar edilmez.
 */
export async function BaslangicKarti({ ctx }: { ctx: HomeCtx }) {
  if (ctx.tvMode || !ctx.tenantId) return null;
  const [snap, probe, jar] = await Promise.all([loadOnboardingSnapshot(ctx.tenantId), loadEmptyProbe(ctx), cookies()]);
  if (!snap) return null;

  const canSettings = (ctx.perms.settings ?? []).includes("edit");
  const completion = snap.profile.completion;
  const showProfile = canSettings && !completion.complete;
  const seeded = Boolean(snap.tenant?.sample_seeded_at);
  const showRetry = ctx.isManagement && jar.get(DEMO_SEED_FAILED_COOKIE)?.value === "1" && !seeded;
  const showSampleLive = !showRetry && canSettings && snap.counts.sampleCustomers > 0;
  const isEmpty = Boolean(probe && probe.customers === 0 && probe.properties === 0);
  const { state } = snap;
  const steps = state.settled
    ? []
    : state.steps
        .filter((s) => !s.done && !snap.skipped.includes(s.id))
        .filter((s) => !(showProfile && (s.id === "office" || s.id === "team")))
        .slice(0, MAX_STEPS);

  if (!showProfile && !showRetry && !showSampleLive && steps.length === 0 && !isEmpty) return null;

  const shown = completion.missing.slice(0, MAX_CHIPS);
  const rest = completion.missing.length - shown.length;
  const offset = C * (1 - completion.percent / 100);

  return (
    <section aria-label="Başlangıç" className="pm-bx flex flex-col gap-4 border border-brand-300/60 bg-brand-600/[0.03] p-4 sm:p-5">
      <header className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
          <Rocket className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold text-ink-950">Başlangıç</h2>
          <p className="text-xs text-text-muted">
            {isEmpty
              ? "Ofisiniz henüz boş. İlk kaydı ekleyin; görevler, randevular ve grafikler veri geldikçe bu ekranda belirir."
              : "Ofisinizi çalışır hale getirmek için kalan adımlar. Tamamlandıkça bu kart kaybolur."}
          </p>
        </div>
        {state.settled ? null : (
          <Link href={`/app/baslangic?adim=${state.nextId}`} className="focus-ring hidden min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-brand-600 hover:underline sm:inline-flex">
            Kurulum %{state.percent} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </header>

      {showRetry ? <OrnekVeriYenile /> : null}

      {showProfile ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex items-center gap-3 sm:w-60 sm:shrink-0">
            <div className="relative grid h-[60px] w-[60px] shrink-0 place-items-center" role="img" aria-label={`Ofis profili %${completion.percent} tamam`}>
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
              <span className="absolute text-sm font-bold tabular-nums text-ink-950">%{completion.percent}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-950">Ofis profilini tamamla</p>
              <p className="text-xs text-text-muted">
                {completion.doneCount}/{completion.total} bilgi tamam
              </p>
            </div>
          </div>
          <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5" aria-label="Eksik bilgiler">
            {shown.map((m) => (
              <li key={m.id}>
                <Link
                  href={profileStepHref(m.step)}
                  className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-ink-950"
                >
                  <Circle className="h-3 w-3 text-text-faint" aria-hidden="true" />
                  {m.label}
                </Link>
              </li>
            ))}
            {rest > 0 ? (
              <li>
                <Link href={PROFILE_WIZARD_HREF} className="focus-ring inline-flex min-h-9 touch:min-h-11 items-center rounded-full px-2 text-xs font-semibold text-brand-600 hover:underline">
                  +{rest} eksik daha
                </Link>
              </li>
            ) : null}
          </ul>
          <ButtonLink href={profileStepHref(completion.nextStep ?? "konum")} size="sm" iconRight={ArrowRight} className="shrink-0">
            Devam et
          </ButtonLink>
        </div>
      ) : null}

      {showSampleLive ? (
        <Link
          href="/app/ayarlar/gercek-kullanim"
          className="focus-ring flex min-h-11 flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2 text-sm transition hover:border-brand-300"
        >
          <FlaskConical className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
          <span className="font-semibold text-ink-950">Örnek veri yüklü ({snap.counts.sampleCustomers} örnek müşteri)</span>
          <span className="ml-auto text-xs font-semibold text-brand-600">Gerçek kullanıma geç</span>
        </Link>
      ) : null}

      {steps.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold text-text-muted">İlk adımlar</p>
            <Progress value={state.percent} label="Kurulum ilerlemesi" className="min-w-24 flex-1" />
            <span className="text-xs tabular-nums text-text-muted">
              {state.doneCount}/{state.total}
            </span>
          </div>
          <ul className="grid gap-2 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/app/baslangic?adim=${s.id}`}
                  className="focus-ring flex min-h-11 flex-col justify-center rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2 transition hover:border-brand-300"
                >
                  <span className="text-sm font-semibold text-ink-950">{s.title}</span>
                  <span className="line-clamp-1 text-xs text-text-muted">{s.description}</span>
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
            Kendi verinizi içe aktarın <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </section>
  );
}
