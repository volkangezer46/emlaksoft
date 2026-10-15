import { Suspense } from "react";
import { PageSegmentTabs, type PageTab } from "@/components/app/page-tabs";
import { ICONS } from "@/lib/icons";
import { effectiveCanAccessModule, effectiveHasPermission } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { SkeletonKpiStrip, SkeletonPanel } from "@/components/ui/skeleton";
import { MatchingView } from "./matching-view";
import { DemandsView } from "./demands-view";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  return { title: (await searchParams).sekme === "eslesme" ? "Eşleşme · Talepler" : "Talepler" };
}

/**
 * Talepler: talep listesi + Eşleşme tek sayfada.
 * Eşleşme sekmesi KENDİ `matching` iznine bağlıdır: izin yoksa sekme gizlenir ve
 * `?sekme=eslesme` talep listesine düşer. Eşleşme görünümü Suspense içinde AKAR (sekme şeridi beklemez);
 * "Teklif al" kısayolu yalnız `offers:create` iznini sunucuda taşıyan rolde çizilir (sözleşme k).
 */
export default async function DemandsPage({
  searchParams,
}: {
  searchParams: Promise<{
  sekme?: string;
  q?: string;
  status?: string;
  aciliyet?: string;
  yas?: string;
  eklenen?: string;
  il?: string;
  ilce?: string;
  butce?: string;
  danisman?: string;
  sayfa?: string;
  yogunluk?: string;
  demand?: string;
  property?: string;
  customer?: string;
  kademe?: string;
  minSkor?: string;
  kriter?: string;
  gizlenen?: string;
}>;
}) {
  const { perms } = await requireModulePage("demands", "/app/talepler");
  const sp = await searchParams;
  const canMatch = effectiveCanAccessModule(perms, "matching");
  const canCreateOffer = effectiveHasPermission(perms, "offers", "create");
  const active = canMatch && sp.sekme === "eslesme" ? "eslesme" : "talepler";
  const tabs: PageTab[] = [{ id: "talepler", label: "Talepler", icon: ICONS.talep }];
  if (canMatch) tabs.push({ id: "eslesme", label: "Eşleşme", icon: ICONS.eslestirme });
  const rest = Promise.resolve(sp);

  return (
    <div className="space-y-6">
      <PageSegmentTabs base="/app/talepler" label="Talep sekmeleri" tabs={tabs} active={active} />
      {active === "eslesme" ? (
        <Suspense
          key={`${sp.customer ?? ""}|${sp.demand ?? ""}|${sp.property ?? ""}|${sp.kriter ?? ""}|${sp.gizlenen ?? ""}`}
          fallback={
            <div className="space-y-6" role="status" aria-label="Eşleşmeler hesaplanıyor">
              <SkeletonKpiStrip cols={4} />
              <SkeletonPanel rows={6} title={false} />
            </div>
          }
        >
          <MatchingView searchParams={rest} canCreateOffer={canCreateOffer} />
        </Suspense>
      ) : (
        <DemandsView searchParams={rest} />
      )}
    </div>
  );
}
