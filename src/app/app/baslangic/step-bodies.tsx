import type { ComponentType, ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { ExternalLink, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { loadRegions, loadSpecialties, loadSpecialtyOptions } from "@/lib/advisor/advisor-store";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { isPoolEnabled } from "@/lib/pool/server";
import type { OnboardingStep } from "@/lib/onboarding-checklist";
import type { OnboardingStepId } from "@/lib/onboarding-steps";
import type { ProfileSnapshot } from "@/lib/profile-completion-data";
import { RegionsEditor, SpecialtiesEditor } from "@/app/app/ekip/[id]/profil-editors";
import { OfficeStep } from "./office-step";
import { PlanStep } from "./plan-step";
import { PoolStep } from "./pool-step";
import { TeamStep } from "./team-step";
import { TitleForm } from "./you-step";

/** Her adım gövdesinin aldığı ortak bağlam (sunucuda `page.tsx` doldurur). */
export type StepBodyProps = {
  step: OnboardingStep;
  nextHref: string;
  tenantId: string;
  userId: string;
  role: string;
  canEditSettings: boolean;
  canInvite: boolean;
  canManageBilling: boolean;
  profile: ProfileSnapshot;
  vitrinHref: string | null;
  /** Kullanıcının mevcut unvanı (Sen adımı). */
  ownTitle: string;
};

type StepBody = (props: StepBodyProps) => ReactNode | Promise<ReactNode>;

async function OfficeBody(p: StepBodyProps) {
  const provinces = await getProvinceOptions();
  const f = p.profile.facts;
  return (
    <OfficeStep
      canEdit={p.canEditSettings}
      nextHref={p.nextHref}
      officeName={p.profile.office.name}
      provinces={provinces}
      provinceId={f.provinceId}
      districtId={f.districtId}
      addressLine={f.addressLine}
      logoUrl={f.logoUrl}
    />
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">{children}</h3>;
}

async function YouBody(p: StepBodyProps) {
  const canManage = p.role === "owner" || p.role === "gm";
  const supabase = await createClient();
  const [specs, regions, options, provinces] = await Promise.all([
    loadSpecialties(supabase, p.tenantId, p.userId),
    loadRegions(supabase, p.tenantId, p.userId),
    canManage ? loadSpecialtyOptions() : Promise.resolve({ propertyTypes: [], segments: [] }),
    canManage ? getProvinceOptions() : Promise.resolve([]),
  ]);
  const available = specs.available && regions.available;
  return (
    <div className="space-y-6">
      <TitleForm defaultTitle={p.ownTitle} />
      {!canManage ? (
        <Alert tone="info">Uzmanlık ve bölgelerini ofis sahibi ya da genel müdür tanımlar. Bu adımı atlayabilirsin.</Alert>
      ) : !available ? (
        <Alert tone="info">Uzmanlık ve bölge tanımları bu ortamda henüz etkin değil; veritabanı güncellemesi uygulanınca açılır.</Alert>
      ) : (
        <>
          <section>
            <SectionTitle>Uzmanlık alanların</SectionTitle>
            <SpecialtiesEditor profileId={p.userId} options={options} defaults={specs.data} />
          </section>
          <section>
            <SectionTitle>Çalıştığın bölgeler</SectionTitle>
            <RegionsEditor profileId={p.userId} provinces={provinces} defaults={regions.data} />
          </section>
        </>
      )}
    </div>
  );
}

function TeamBody(p: StepBodyProps) {
  return <TeamStep canInvite={p.canInvite} nextHref={p.nextHref} />;
}

async function PoolBody(p: StepBodyProps) {
  const enabled = await isPoolEnabled(await createClient(), p.tenantId);
  return <PoolStep enabled={enabled} canConfigure={p.role === "owner" || p.role === "gm"} />;
}

function ChoiceLink({ href, icon, title, text }: { href: string; icon: ReactNode; title: string; text: string }) {
  return (
    <Link
      href={href}
      className="focus-ring group flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{text}</span>
      </span>
    </Link>
  );
}

function PortalsBody(p: StepBodyProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceLink
          href="/app/portallar"
          icon={<ExternalLink className="h-5 w-5" aria-hidden />}
          title="Portal yayınları"
          text="İlanları portallara gönderin, yayın durumunu ve onay bekleyenleri izleyin."
        />
        <ChoiceLink
          href="/app/ayarlar/lead"
          icon={<Sparkles className="h-5 w-5" aria-hidden />}
          title="Talep toplama ve mesaj kanalı"
          text="Web formu ve WhatsApp/SMS bağlantısıyla gelen talepler doğrudan sana düşsün."
        />
      </div>
      {p.vitrinHref ? (
        <p className="text-sm text-text-muted">
          Vitrinin:{" "}
          <a className="font-semibold text-brand-600 hover:underline" href={p.vitrinHref} target="_blank" rel="noreferrer">
            {p.vitrinHref}
          </a>
        </p>
      ) : null}
    </div>
  );
}

async function PlanBody(p: StepBodyProps) {
  const { plans, offers, trialDays, efValuationCost, efLive } = await getPublicPricing();
  return (
    <PlanStep
      plans={plans}
      offers={offers}
      trialText={trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz deneme"}
      efValuationCost={efValuationCost}
      efLive={efLive}
      nextHref={p.nextHref}
      canManageBilling={p.canManageBilling}
    />
  );
}

/**
 * Adım gövdeleri. Kayıtta olmayan adım (`onboarding-steps.ts`'e sonradan eklenen) için gövde yazmak ŞART DEĞİL:
 * kayda `href` verilirse `FallbackBody` o sayfaya "Aç" düğmesi çizer. Özel gövde isteyen adım buraya
 * `<adım-kimliği>: Bileşen` ekler.
 */
export const STEP_BODIES: Partial<Record<OnboardingStepId, StepBody>> = {
  office: OfficeBody,
  you: YouBody,
  team: TeamBody,
  pool: PoolBody,
  portals: PortalsBody,
  plan: PlanBody,
};

export function FallbackBody({ step }: { step: OnboardingStep }) {
  if (!step.href) return <Alert tone="info">Bu adım için sayfa henüz tanımlı değil. Atlayabilirsin.</Alert>;
  return (
    <ButtonLink href={step.href} variant="secondary" iconRight={ExternalLink}>
      {step.title} sayfasını aç
    </ButtonLink>
  );
}

export function renderStepBody(props: StepBodyProps): ReactNode {
  const Body = STEP_BODIES[props.step.id] as ComponentType<StepBodyProps> | undefined;
  return Body ? <Body {...props} /> : <FallbackBody step={props.step} />;
}
