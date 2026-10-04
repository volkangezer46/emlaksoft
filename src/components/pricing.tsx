"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import { PLANS, planAmountOf, type PlanDef, type PlanId } from "@/lib/billing/plans";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  Crown,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { formatNumberTr } from "@/lib/format";

const PLAN_ICONS: Record<PlanId, ComponentType<{ className?: string }>> = {
  advisor: UserRound,
  office: Building2,
  professional: BriefcaseBusiness,
  enterprise: Crown,
};

const formatTL = formatNumberTr;

/** `plans`: sunucudan gelen etkin (panelden düzenlenebilir) tanımlar; verilmezse plans.ts varsayılanı. */
export function Pricing({ plans = PLANS }: { plans?: readonly PlanDef[] } = {}) {
  const [yearly, setYearly] = useState(false);

  return (
    <div>
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
          className={`relative mx-1 h-7 w-13 rounded-full p-0.5 transition-colors duration-300 ${
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
            yearly ? "bg-brand-600/10 text-brand-600" : "text-text-muted"
          }`}
        >
          Yıllık
          <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-semibold text-mint-600">
            %20 indirim
          </span>
        </span>
      </div>

      <div className="mt-9 grid gap-4 lg:grid-cols-4">
        {plans.map((plan) => {
          const PlanIcon = PLAN_ICONS[plan.id];
          const price = yearly
            ? Math.round(planAmountOf(plan, "yearly") / 12)
            : planAmountOf(plan, "monthly");
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
                <>
                  <div
                    className="pointer-events-none absolute -inset-px -z-10 rounded-[var(--radius-panel)] opacity-70 blur-md"
                    style={{ background: "var(--grad-brand)" }}
                  />

                </>
              ) : null}

              <div className="flex items-center gap-3">
                <span className={`grid h-11 w-11 place-items-center rounded-[var(--radius-card)] ${plan.popular ? "bg-white/10 text-mint-400" : "bg-brand-600/10 text-brand-600"}`}>
                  <PlanIcon className="h-5 w-5" />
                </span>
                <div>
                  <span className={`text-xs font-extrabold tracking-[0.08em] ${plan.popular ? "text-mint-400" : "text-text-faint"}`}>{plan.eyebrow}</span>
                  <h3
                className={`font-display text-lg font-bold ${
                  plan.popular ? "text-white" : "text-ink-950"
                }`}
              >
                {plan.name}
              </h3>
                </div>
              </div>
              <p
                className={`mt-4 text-sm ${
                  plan.popular ? "text-white/70" : "text-text-muted"
                }`}
              >
                {plan.blurb}
              </p>

              <div className="mt-5 flex items-end gap-1">
                <span
                  className={`font-display text-4xl font-bold tabular-nums ${
                    plan.popular ? "text-white" : "text-ink-950"
                  }`}
                >
                  {formatTL(price)} ₺
                </span>
                <span
                  className={`mb-1 text-sm ${
                    plan.popular ? "text-white/60" : "text-text-muted"
                  }`}
                >
                  /ay
                </span>
              </div>
              <p
                className={`mt-1 text-xs ${
                  plan.popular ? "text-white/50" : "text-text-faint"
                }`}
              >
                {yearly ? "Yıllık faturalandırılır · KDV hariç" : "KDV hariç"}
              </p>
              {yearly ? (
                <p className={`mt-2 text-xs font-semibold ${plan.popular ? "text-mint-400" : "text-mint-600"}`}>
                  Yılda {formatTL(plan.monthlyTry * 12 * 0.2)} ₺ tasarruf
                </p>
              ) : null}

              <ul className="mt-5 flex-1 space-y-3 border-t border-current/10 pt-5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                        plan.popular ? "bg-mint-500/25" : "bg-mint-500/15"
                      }`}
                    >
                      <Check
                        className={`h-3 w-3 ${
                          plan.popular ? "text-mint-400" : "text-mint-600"
                        }`}
                      />
                    </span>
                    <span
                      className={
                        plan.popular ? "text-white/85" : "text-text"
                      }
                    >
                      {f}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href={`/kayit?plan=${plan.id}&cycle=${yearly ? "yearly" : "monthly"}`}
                className={`btn-shine mt-7 inline-flex w-full items-center justify-center rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-semibold transition ${
                  plan.popular
                    ? "bg-white text-ink-950 hover:bg-white/90"
                    : "bg-brand-600 text-white hover:bg-brand-700"
                }`}
              >
                14 gün ücretsiz başla <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <p className={`mt-3 flex items-center justify-center gap-1.5 text-xs ${plan.popular ? "text-white/45" : "text-text-faint"}`}>
                <ShieldCheck className="h-3.5 w-3.5" /> Demo çalışma alanıyla özellikleri keşfedin
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
