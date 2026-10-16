import type { ComponentType, ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { ExternalLink, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getProvinceOptions } from "@/lib/geo/reader";
import { loadRegions, loadSpecialties, loadSpecialtyOptions } from "@/lib/advisor/advisor-store";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { getPlanDefinition } from "@/lib/billing/plan-definitions";
import { onlinePaymentMode, PAYMENT_OFF_TEXT, PAYMENT_SUPPORT_HREF } from "@/lib/billing/payment-mode";
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
import { GiderlerKasaStep } from "./steps/giderler-kasa-step";
import { OfisTipiStep, type OfisTipiPreset } from "./steps/ofis-tipi-step";
import { VeriStep } from "./steps/veri-step";
import { YetkiBelgesiStep } from "./steps/yetki-belgesi-step";
import { EidsForwardingGuide } from "@/components/eids/forwarding-guide";
import { EidsLegalNote } from "@/components/eids/legal-note";
import { EIDS_HELP_HREF, EIDS_MAILBOX_SETTINGS_HREF } from "@/lib/eids/links";
import { getEffectiveLegalValues } from "@/lib/legal-constants/store";
import { getTenantModuleState } from "@/lib/modules/state";
import { getTenantGateContext } from "@/lib/cache/request";
import { canManageModules } from "@/lib/modules/permissions";
import { planLockedKeys } from "@/lib/modules/plan";
import { computePresetChanges, MODULE_PRESETS } from "@/lib/modules/logic";
import { getModuleDef } from "@/lib/modules/registry";
import { PortalMembershipsSection } from "@/app/app/ayarlar/entegrasyonlar/portal-memberships-section";

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
  /** Kullanıcının mevcut unvanı (Siz adımı). */
  ownTitle: string;
  /** İçe aktarma yetkisi (müşteri ekleme; "Verilerinizi taşıyın" adımı). */
  canImport: boolean;
  /** Boş ofis: örnek veri önerilir ("Verilerinizi taşıyın" adımı). */
  showSampleData: boolean;
  canSeedSample: boolean;
  impersonating: boolean;
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
        <Alert tone="info">Uzmanlık ve bölgelerinizi ofis sahibi ya da genel müdür tanımlar. Bu adımı atlayabilirsiniz.</Alert>
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

function YetkiBelgesiBody(p: StepBodyProps) {
  return <YetkiBelgesiStep canEdit={p.canEditSettings} nextHref={p.nextHref} licenseNo={p.profile.facts.licenseNo} />;
}

/**
 * "Bakanlık e-postalarını EmlakSoft'a ilet": sağlayıcı sekmeli kılavuz. Alma adresi Ayarlar > Entegrasyonlar kartında
 * üretilir (EP3); burada adres yerine yer tutucu yazılır ve karta bağlantı verilir. Atlanabilir; tamamlanana kadar
 * ana ekran Başlangıç kartı adımı hatırlatır. Ceza tutarı o gün yürürlükteki mevzuat değeridir.
 */
async function EidsEpostaBody(p: StepBodyProps) {
  if (!p.canEditSettings) {
    return <Alert tone="info">İletme kuralını Bakanlık e-postalarının geldiği kutunun sahibi kurar (genelde ofis sahibi). Bu adımı atlayabilirsin.</Alert>;
  }
  const legalValues = await getEffectiveLegalValues();
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Malik e-Devlet&apos;te yetki verince ya da iptal edince Bakanlık bir e-posta gönderebilir. Posta kutunda yalnız bu göndericiyi
        EmlakSoft&apos;a ileten bir kural kurarsan portföy eşleşir ve gerekli görev kendiliğinden açılır. Şimdi kuramıyorsan atla;
        tamamlanana kadar Başlangıç kartında hatırlatılır.
      </p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={EIDS_MAILBOX_SETTINGS_HREF} variant="secondary" iconRight={ExternalLink}>
          Alma adresimi göster
        </ButtonLink>
        <ButtonLink href={EIDS_HELP_HREF} variant="ghost">
          Kılavuzun tamamı
        </ButtonLink>
      </div>
      <EidsForwardingGuide address={null} />
      <EidsLegalNote variant="compact" values={legalValues} />
    </div>
  );
}

function TeamBody(p: StepBodyProps) {
  return <TeamStep canInvite={p.canInvite} nextHref={p.nextHref} />;
}

async function PoolBody(p: StepBodyProps) {
  const enabled = await isPoolEnabled(await createClient(), p.tenantId);
  // Adım "havuz açık VE en az bir gerçek uzmanlık/bölge kaydı" ile tamamlanır; açık ama tamamlanmamışsa eksik olan kayıttır.
  return (
    <PoolStep
      enabled={enabled}
      canConfigure={p.role === "owner" || p.role === "gm"}
      missingRecords={enabled && !p.step.done}
    />
  );
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
      {/* EP1: "Hangi portallarda ilan veriyorsunuz?" — öneriler işaretli gelir, kayıt sahibin onayıyla. */}
      {p.canEditSettings ? <PortalMembershipsSection question /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceLink
          href="/app/ilan-kontrol/portallar"
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

function GiderlerKasaBody(p: StepBodyProps) {
  // Gider yazma yetkisi sunucuda saklanan rolden türetilir; asıl kapı action'da (expenses:create). Maaş yalnız owner/gm.
  const canEdit = ["owner", "gm", "branch_manager", "accounting"].includes(p.role);
  return <GiderlerKasaStep canEdit={canEdit} canSalary={p.role === "owner" || p.role === "gm"} nextHref={p.nextHref} />;
}

/** Hazır düzen → ofis tipi tanım şablonu (kayıp nedenleri, müşteri kaynakları; onboarding-templates). */
const PRESET_TEMPLATE: Record<string, string> = { konut: "konut", arsa_ticari: "arsa", kiralama: "konut", franchise: "konut" };

/**
 * "Ne iş yapıyorsunuz?": hazır düzenlerin etkisi ofisin GERÇEK modül durumundan önceden hesaplanır (Ayarlar > Modüller
 * önizlemesiyle aynı `computePresetChanges`); platform/paket kilitli modüle dokunulmaz.
 */
async function OfisTipiBody(p: StepBodyProps) {
  const canEdit = p.canEditSettings && canManageModules(p.role) && !p.impersonating;
  if (!canEdit) return <OfisTipiStep presets={[]} canEdit={false} rentalsPlanLocked={false} nextHref={p.nextHref} />;
  const [state, planCtx] = await Promise.all([getTenantModuleState(p.tenantId), getTenantGateContext(p.tenantId)]);
  const planLocked = planLockedKeys(planCtx);
  const label = (k: string) => getModuleDef(k as Parameters<typeof getModuleDef>[0]).label;
  const presets: OfisTipiPreset[] = MODULE_PRESETS.map((m) => {
    const diff = computePresetChanges(m, state.closed, { locked: state.locked, planLocked });
    return {
      id: m.id,
      title: m.title,
      desc: m.desc,
      closes: diff.toClose.map(label),
      opens: diff.toOpen.map(label),
      rentalsDefault: m.id === "kiralama",
      template: PRESET_TEMPLATE[m.id] ?? "konut",
    };
  });
  return (
    <OfisTipiStep presets={presets} canEdit rentalsPlanLocked={planLocked.includes("rentals")} nextHref={p.nextHref} />
  );
}

function VeriBody(p: StepBodyProps) {
  return <VeriStep canImport={p.canImport} showSampleData={p.showSampleData} canSeedSample={p.canSeedSample} />;
}

/**
 * Paket adımı ofisin GERÇEK paketini ve üye sayısını gösterir: ödenmiş abonelikte "Mevcut paketiniz" özeti (öneri yok),
 * denemede danışman sayısı üye sayısıyla başlar. Satın alma bağlantısı abonelik sayfasıyla aynı ödeme bayrağına bağlıdır.
 */
async function PlanBody(p: StepBodyProps) {
  const supabase = await createClient();
  const [{ plans, offers, trialDays, efValuationCost, efLive }, subRes, tenantRes, membersRes] = await Promise.all([
    getPublicPricing(),
    supabase.from("subscriptions").select("plan, status").eq("tenant_id", p.tenantId).maybeSingle(),
    supabase.from("tenants").select("plan").eq("id", p.tenantId).maybeSingle(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", p.tenantId).eq("is_active", true),
  ]);
  const sub = subRes.data as { plan?: string | null; status?: string | null } | null;
  const planId = sub?.plan ?? (tenantRes.data as { plan?: string | null } | null)?.plan ?? null;
  const planDef = planId ? await getPlanDefinition(planId).catch(() => null) : null;
  const members = Math.max(1, membersRes.count ?? 1);
  const mode = onlinePaymentMode();
  return (
    <PlanStep
      plans={plans}
      offers={offers}
      trialText={trialDays ? `${trialDays} gün ücretsiz` : "Ücretsiz deneme"}
      efValuationCost={efValuationCost}
      efLive={efLive}
      nextHref={p.nextHref}
      canManageBilling={p.canManageBilling}
      current={
        p.step.done && planDef
          ? { planName: planDef.name, members, seatLimit: planDef.limits.seats }
          : null
      }
      initialSeats={members}
      paymentOffNote={mode === "off" ? PAYMENT_OFF_TEXT : null}
      supportHref={PAYMENT_SUPPORT_HREF}
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
  "ofis-tipi": OfisTipiBody,
  veri: VeriBody,
  team: TeamBody,
  "yetki-belgesi": YetkiBelgesiBody,
  you: YouBody,
  pool: PoolBody,
  portals: PortalsBody,
  "eids-eposta": EidsEpostaBody,
  "giderler-kasa": GiderlerKasaBody,
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
