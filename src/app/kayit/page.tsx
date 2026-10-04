import { RegisterForm } from "./register-form";
import { normalizeBillingCycle, normalizePlanId } from "@/lib/billing/plans";
import { getPlanDefinitions } from "@/lib/billing/plan-definitions";

export const metadata = {
  title: "Ofisinizi Ücretsiz Oluşturun",
  description:
    "14 gün ücretsiz deneme ile EmlakSoft'a başlayın. Kredi kartı gerekmez. Deneme boyunca tüm paketlerin özellikleri açıktır. Portföy, müşteri ve komisyon yönetimi tek platformda.",
  alternates: { canonical: "/kayit" },
  openGraph: {
    title: "EmlakSoft — Ücretsiz Başla",
    description: "14 gün ücretsiz deneme. Emlak ofisinizi bugün dijitalleştirin.",
    url: "/kayit",
  },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}) {
  const params = await searchParams;
  const plans = await getPlanDefinitions();
  return (
    <RegisterForm
      plans={plans}
      initialPlan={normalizePlanId(params.plan)}
      initialCycle={normalizeBillingCycle(params.cycle)}
    />
  );
}
