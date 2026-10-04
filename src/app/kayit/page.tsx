import Link from "next/link";
import { RegisterForm } from "./register-form";
import { isRegistrationOpen } from "@/lib/platform-flags";
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/platform-setting-keys";
import { normalizeBillingCycle, normalizePlanId } from "@/lib/billing/plans";
import { getEffectiveTrialDays, getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";

import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/kayit");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}) {
  const params = await searchParams;
  if (!(await isRegistrationOpen())) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-16">
        <div className="w-full max-w-md rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-center shadow-[var(--shadow-xs)]">
          <h1 className="font-display text-2xl font-extrabold text-ink-950">Kayıtlar geçici olarak kapalı</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">{REGISTRATION_CLOSED_MESSAGE}</p>
          <Link
            href="/giris"
            className="mt-6 inline-flex min-h-[42px] items-center rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Giriş yap
          </Link>
        </div>
      </main>
    );
  }
  const [plans, trialDays] = await Promise.all([getPublicPlanDefinitions(), getEffectiveTrialDays()]);
  return (
    <RegisterForm
      plans={plans}
      trialDays={trialDays}
      initialPlan={normalizePlanId(params.plan)}
      initialCycle={normalizeBillingCycle(params.cycle)}
    />
  );
}
