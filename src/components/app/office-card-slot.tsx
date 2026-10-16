import { Suspense } from "react";
import { loadOfficeIdentity } from "@/lib/app-shell/office-identity";
import { getOfficeScoreCached } from "@/lib/office-score";
import { OfficeCard } from "@/components/app/office-card";

type Props = { tenantId: string | null; name: string; plan: string; href: string | null; withScore?: boolean };

/**
 * Ofis kartı: logo + şehir (tek PK sorgusu, kabukla aynı anda ısıtılır) ve yönetim rollerinde ofis skoru (tenant başına
 * 3 dk önbellekli); gelene dek aynı ölçüde yalnız ad. Skor hesaplanamazsa kart skorsuz çizilir (sahte değer yok).
 */
async function OfficeCardStream({ tenantId, name, plan, href, withScore = false }: Props) {
  const [id, score] = await Promise.all([
    loadOfficeIdentity(tenantId),
    withScore && tenantId ? getOfficeScoreCached(tenantId).catch(() => null) : Promise.resolve(null),
  ]);
  return <OfficeCard name={id?.name ?? name} city={id?.city ?? null} logoUrl={id?.logoUrl ?? null} plan={plan} href={href} score={score} />;
}

/** Yan menü ofis kartı yuvası (SUNUCU): kendi sınırında akar, kabuk ve sayfa beklemez. */
export function OfficeCardSlot(props: Props) {
  return (
    <Suspense fallback={<OfficeCard name={props.name} plan={props.plan} href={props.href} />}>
      <OfficeCardStream {...props} />
    </Suspense>
  );
}
