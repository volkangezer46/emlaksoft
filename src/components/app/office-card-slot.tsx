import { Suspense } from "react";
import { loadOfficeIdentity } from "@/lib/app-shell/office-identity";
import { OfficeCard } from "@/components/app/office-card";

type Props = { tenantId: string | null; name: string; plan: string; href: string | null };

/** Ofis kartı: logo + şehir (tek PK sorgusu, kabukla aynı anda ısıtılır); gelene dek aynı ölçüde yalnız ad. */
async function OfficeCardStream({ tenantId, name, plan, href }: Props) {
  const id = await loadOfficeIdentity(tenantId);
  return <OfficeCard name={id?.name ?? name} city={id?.city ?? null} logoUrl={id?.logoUrl ?? null} plan={plan} href={href} />;
}

/** Yan menü ofis kartı yuvası (SUNUCU): kendi sınırında akar, kabuk ve sayfa beklemez. */
export function OfficeCardSlot(props: Props) {
  return (
    <Suspense fallback={<OfficeCard name={props.name} plan={props.plan} href={props.href} />}>
      <OfficeCardStream {...props} />
    </Suspense>
  );
}
