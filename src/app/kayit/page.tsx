import { RegisterForm } from "./register-form";
import { normalizeBillingCycle, normalizePlanId } from "@/lib/billing/plans";

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
  return (
    <RegisterForm
      initialPlan={normalizePlanId(params.plan)}
      initialCycle={normalizeBillingCycle(params.cycle)}
    />
  );
}
