import { ArrowRight, Check, Lock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PLAN_GATES, requiredPlanName } from "@/lib/billing/page-gates";
import { getPlan } from "@/lib/billing/plans";
import { requireModulePage } from "@/lib/require-module-page";
import { formatTry } from "@/lib/utils";

export const metadata = { title: "Paketinizi yükseltin" };

/**
 * Paket kilidine takılan sayfaların varış noktası. Kullanıcıya özelliğin ne işe
 * yaradığını, hangi pakette açıldığını ve fiyatını gösterir; kilit bir hata değil,
 * yükseltme önerisi olarak sunulur.
 */
export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ ozellik?: string }>;
}) {
  await requireModulePage("dashboard");
  const { ozellik } = await searchParams;
  const gate = PLAN_GATES.find((g) => g.href === ozellik) ?? null;
  const plan = gate ? getPlan(gate.minPlan) : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow="Paketinize dahil değil"
        title={gate?.title ?? "Bu özellik paketinize dahil değil"}
        description={gate?.pitch ?? "Daha fazla özellik için paketinizi yükseltebilirsiniz."}
        breadcrumbs={[{ label: "Ana ekran", href: "/app" }, { label: "Paket" }]}
      />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] tone-info">
              <Lock className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <CardTitle>
                {plan ? `${requiredPlanName(gate!)} paketiyle açılır` : "Paketleri karşılaştırın"}
              </CardTitle>
              {plan ? (
                <p className="mt-0.5 text-xs text-text-muted">
                  {formatTry(plan.monthlyTry)} / ay + KDV · yıllıkta yaklaşık %20 indirim
                </p>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {plan ? (
            <>
              <p className="text-sm font-medium text-text">{plan.name} paketinde şunlar var:</p>
              <ul className="mt-3 space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-text-muted">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/app/abonelik" iconRight={ArrowRight}>
              Paketi yükselt
            </ButtonLink>
            <ButtonLink href="/app" variant="secondary">
              Ana ekrana dön
            </ButtonLink>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
