"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import { PLANS, planAmountOf, yearlyOfferLabel, type PlanDef, type PlanId } from "@/lib/billing/plans";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  Crown,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { formatNumberTr } from "@/lib/format";
import type { ExtraSeatSummary } from "@/lib/billing/seat-calculator-model";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { efCreditsLine, monthlyUnitsOf } from "@/lib/ef-credits/plan-credits";

const PLAN_ICONS: Record<PlanId, ComponentType<{ className?: string }>> = {
  advisor: UserRound,
  office: Building2,
  professional: BriefcaseBusiness,
  business: Building2,
  enterprise: Crown,
};

const formatTL = formatNumberTr;

/** Sunucudan gelen etkin teklif (kampanya dahil). `PublicOffer` ile aynı biçim; istemci paketine sunucu modülü girmesin diye yerel tür. */
export type PricingOffer = { monthlyTry: number; listMonthlyTry: number; campaign: boolean };
export type PricingFounders = { name: string; remaining: number; quota: number };

function limitText(n: number | null, unit: string): string {
  return n === null ? `Sınırsız ${unit}` : `${formatTL(n)} ${unit}`;
}

/** Paketin kapsam çipleri: yalnız panelde tanımlı alanlar (limit, ek kullanıcı, AI/değerleme kotası). */
function planFacts(plan: PlanDef): string[] {
  const out = [
    `${formatTL(plan.limits.seats)} kullanıcı`,
    plan.limits.branches === null ? "Sınırsız şube" : `${formatTL(plan.limits.branches)} şube`,
    limitText(plan.limits.customers, "müşteri"),
    limitText(plan.limits.activeProperties, "aktif portföy"),
  ];
  if (plan.aiCreditsMonthly != null) out.push(`Aylık ${formatTL(plan.aiCreditsMonthly)} AI kredisi`);
  if (plan.valuationReportsMonthly != null) out.push(`Aylık ${formatTL(plan.valuationReportsMonthly)} değerleme raporu`);
  return out;
}

/**
 * `plans`: sunucudan gelen etkin (panelden düzenlenebilir) tanımlar. `offers`/`founders`/`trialDays` de
 * sunucuda okunur (getPublicPricing); deneme günü verilmezse sayı yazılmaz.
 */
export function Pricing({
  plans = PLANS,
  trialDays,
  offers,
  founders = null,
  extraSeats,
  efValuationCost,
}: {
  /** Bir değerlemenin kontör bedeli (sunucuda tarifeden okunur); verilmezse "yaklaşık değerleme" kısmı yazılmaz. */
  efValuationCost?: number;
  /**
   * Plan kimliğine göre ek kullanıcı kademe metni; SUNUCUDA `extraSeatSummary` ile üretilir (fiyat motoru
   * istemci paketine girmesin diye). Verilmezse metin gösterilmez.
   */
  extraSeats?: Record<string, ExtraSeatSummary | null>;
  plans?: readonly PlanDef[];
  trialDays?: number;
  offers?: Record<string, PricingOffer>;
  founders?: PricingFounders | null;
} = {}) {
  const [yearly, setYearly] = useState(false);
  const priced = plans.filter((p) => !p.customPricing);
  const monthsLabels = new Set(priced.map((p) => yearlyOfferLabel(p)));
  const yearlyBadge = monthsLabels.size === 1 ? [...monthsLabels][0]! : "Yıllık avantaj";
  const cols = plans.length >= 4 ? "lg:grid-cols-4" : plans.length === 3 ? "lg:grid-cols-3" : plans.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1";
  const trialCta = trialDays ? `${trialDays} gün ücretsiz başla` : "Ücretsiz başla";
  const anyCredits = plans.some((p) => monthlyUnitsOf(p.efCreditsMonthly) > 0);

  return (
    <div>
      {founders ? (
        <p className="mx-auto mt-6 flex w-fit max-w-full items-center gap-2 rounded-full border border-mint-500/30 bg-mint-500/10 px-4 py-2 text-sm font-semibold text-mint-700">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0" />
          <span>
            {founders.name}: indirimli fiyat, kalan kontenjan {formatTL(founders.remaining)} / {formatTL(founders.quota)}
          </span>
        </p>
      ) : null}

      <div className="mx-auto mt-8 flex w-fit items-center gap-1 rounded-[var(--radius-card)] border border-line bg-surface p-1.5 shadow-[var(--shadow-sm)]">
        <span
          className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold transition ${
            yearly ? "text-text-muted" : "bg-[var(--ink-950)] text-white shadow-[var(--shadow-xs)]"
          }`}
        >
          Aylık
        </span>
        <button
          type="button"
          role="switch"
          aria-label="Yıllık faturalandırma"
          aria-checked={yearly}
          onClick={() => setYearly((v) => !v)}
          className={`relative mx-1 h-7 w-13 rounded-full p-0.5 transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
            yearly ? "bg-brand-600" : "bg-line-strong"
          }`}
          style={{ width: 52 }}
        >
          <span
            className={`block h-6 w-6 rounded-full bg-white shadow transition-transform duration-300 ${
              yearly ? "translate-x-6" : "translate-x-0"
            }`}
          />
        </button>
        <span
          className={`flex items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold transition ${
            yearly ? "bg-brand-600/10 text-brand-700" : "text-text-muted"
          }`}
        >
          Yıllık
          <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-semibold text-mint-700">{yearlyBadge}</span>
        </span>
      </div>

      <div className={`mt-9 grid gap-4 sm:grid-cols-2 ${cols}`}>
        {plans.map((plan) => {
          const PlanIcon = PLAN_ICONS[plan.id];
          const offer = offers?.[plan.id];
          const effectiveMonthly = offer?.monthlyTry ?? plan.monthlyTry;
          const onCampaign = Boolean(offer?.campaign);
          const effective = { ...plan, monthlyTry: effectiveMonthly };
          const extra = extraSeats?.[plan.id] ?? null;
          const price = yearly ? Math.round(planAmountOf(effective, "yearly") / 12) : planAmountOf(effective, "monthly");
          const listPrice = yearly ? Math.round(planAmountOf(plan, "yearly") / 12) : plan.monthlyTry;
          const yearlySaving = plan.monthlyTry * 12 - planAmountOf(effective, "yearly");
          return (
            <div
              key={plan.id}
              className={`pricing-card card-hover relative isolate flex flex-col overflow-hidden rounded-[var(--radius-panel)] border p-6 ${
                plan.popular
                  ? "theme-dark border-brand-500/40 bg-[image:var(--grad-ink)] text-white shadow-[var(--shadow-lg)]"
                  : "border-line bg-surface"
              }`}
            >
              <PlanIcon className={`pointer-events-none absolute -right-8 -top-8 -z-10 h-40 w-40 ${plan.popular ? "text-white/[0.045]" : "text-brand-600/[0.035]"}`} />
              {plan.popular ? (
                <div
                  className="pointer-events-none absolute -inset-px -z-10 rounded-[var(--radius-panel)] opacity-70 blur-md"
                  style={{ background: "var(--grad-brand)" }}
                />
              ) : null}

              <div className="flex items-center gap-3">
                <span className={`grid h-11 w-11 place-items-center rounded-[var(--radius-card)] ${plan.popular ? "bg-white/10 text-mint-400" : "bg-brand-600/10 text-brand-700"}`}>
                  <PlanIcon className="h-5 w-5" />
                </span>
                <div>
                  <span className={`text-xs font-extrabold tracking-[0.08em] ${plan.popular ? "text-mint-400" : "text-text-muted"}`}>{plan.eyebrow}</span>
                  <h3 className={`font-display text-lg font-bold ${plan.popular ? "text-white" : "text-ink-950"}`}>{plan.name}</h3>
                </div>
              </div>
              <p className={`mt-4 text-sm ${plan.popular ? "text-white/75" : "text-text-muted"}`}>{plan.blurb}</p>

              <div className="mt-5 flex min-h-12 flex-wrap items-end gap-x-2">
                {plan.customPricing ? (
                  <span className={`font-display text-3xl font-bold ${plan.popular ? "text-white" : "text-ink-950"}`}>Özel teklif</span>
                ) : (
                  <>
                    <span className={`font-display text-4xl font-bold tabular-nums ${plan.popular ? "text-white" : "text-ink-950"}`}>
                      <AnimatedNumber value={price} suffix=" ₺" />
                    </span>
                    <span className={`mb-1 text-sm ${plan.popular ? "text-white/70" : "text-text-muted"}`}>/ay</span>
                    {onCampaign ? (
                      <span className={`mb-1 text-sm tabular-nums line-through ${plan.popular ? "text-white/60" : "text-text-muted"}`}>
                        {formatTL(listPrice)} ₺
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              <p className={`mt-1 text-xs ${plan.popular ? "text-white/65" : "text-text-muted"}`}>
                {plan.customPricing
                  ? "Ekibinize göre hazırlanır"
                  : yearly
                    ? `Yıllık faturalandırılır (${yearlyOfferLabel(plan)}) · KDV hariç`
                    : "KDV hariç"}
              </p>
              {yearly && !plan.customPricing && yearlySaving > 0 ? (
                <p className={`mt-2 text-xs font-semibold ${plan.popular ? "text-mint-400" : "text-mint-700"}`}>
                  Yılda {formatTL(yearlySaving)} ₺ tasarruf
                </p>
              ) : null}
              {onCampaign && founders ? (
                <p className={`mt-2 text-xs font-semibold ${plan.popular ? "text-mint-400" : "text-mint-700"}`}>{founders.name} fiyatı</p>
              ) : null}

              <ul aria-label={`${plan.name} kapsamı`} className="mt-4 flex flex-wrap gap-1.5">
                {planFacts(plan).map((f) => (
                  <li
                    key={f}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      plan.popular ? "bg-white/10 text-white/85" : "bg-surface-2 text-text"
                    }`}
                  >
                    {f}
                  </li>
                ))}
              </ul>
              {efCreditsLine(plan.efCreditsMonthly, efValuationCost ?? 0) ? (
                <p className={`mt-3 text-xs font-semibold ${plan.popular ? "text-mint-400" : "text-mint-700"}`}>
                  {efCreditsLine(plan.efCreditsMonthly, efValuationCost ?? 0)}
                </p>
              ) : null}
              {extra ? (
                <p className={`mt-3 text-xs leading-relaxed ${plan.popular ? "text-white/75" : "text-text-muted"}`}>
                  <span className="font-semibold">Ek kullanıcı:</span> {extra.included}, {extra.tiers.join(", ")} (kullanıcı başı, ₺/ay, KDV hariç).
                  {extra.max ? ` ${extra.max}.` : ""}
                </p>
              ) : null}

              <ul className="mt-5 flex-1 space-y-3 border-t border-current/10 pt-5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${plan.popular ? "bg-mint-500/25" : "bg-mint-500/15"}`}>
                      <Check aria-hidden className={`h-3 w-3 ${plan.popular ? "text-mint-400" : "text-mint-700"}`} />
                    </span>
                    <span className={plan.popular ? "text-white/90" : "text-text"}>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.customPricing ? "/demo" : `/kayit?plan=${plan.id}&cycle=${yearly ? "yearly" : "monthly"}`}
                className={`btn-shine mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                  plan.popular ? "bg-white text-ink-950 hover:bg-white/90" : "bg-brand-600 text-white hover:bg-brand-700"
                }`}
              >
                {plan.customPricing ? "Bize ulaşın" : trialCta} <ArrowRight aria-hidden className="ml-2 h-4 w-4" />
              </Link>
              <p className={`mt-3 flex items-center justify-center gap-1.5 text-xs ${plan.popular ? "text-white/65" : "text-text-muted"}`}>
                <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> Demo çalışma alanıyla özellikleri keşfedin
              </p>
            </div>
          );
        })}
      </div>
      {anyCredits ? (
        <p className="mx-auto mt-5 max-w-2xl text-center text-xs text-text-muted">
          Kontör, EmlakFiyati değerleme ve PDF rapor sorguları içindir. Paket kontörü bittiğinde kontör ile ek sorgu satın alınabilir.
        </p>
      ) : null}
    </div>
  );
}
