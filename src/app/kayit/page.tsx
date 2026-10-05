import Link from "next/link";
import { RegisterForm } from "./register-form";
import { isRegistrationOpen } from "@/lib/platform-flags";
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/platform-setting-keys";
import { normalizeBillingCycle, normalizePlanId } from "@/lib/billing/plans";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { getLiveSiteContent } from "@/lib/site-content/store";
import { tx } from "@/lib/site-content/tokens";

import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/store";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata("/kayit");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    plan?: string;
    cycle?: string;
    seats?: string;
    ref?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  }>;
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
  const [{ plans, trialDays, offers, efValuationCost }, content] = await Promise.all([getPublicPricing(), getLiveSiteContent()]);
  const tokenCtx = { trialDays, plans };
  return (
    <RegisterForm
      copy={{
        title: tx(content.register.title, tokenCtx),
        text: tx(content.register.text, tokenCtx),
        panelText: tx(content.register.panelText, tokenCtx),
      }}
      plans={plans}
      trialDays={trialDays}
      offers={offers}
      efValuationCost={efValuationCost}
      initialPlan={normalizePlanId(params.plan)}
      initialCycle={normalizeBillingCycle(params.cycle)}
      initialSeats={/^\d{1,3}$/.test(params.seats ?? "") && Number(params.seats) > 0 ? Number(params.seats) : undefined}
      attribution={{
        ref: params.ref,
        utm_source: params.utm_source,
        utm_medium: params.utm_medium,
        utm_campaign: params.utm_campaign,
      }}
    />
  );
}
