import { Suspense } from "react";
import { requireModulePage } from "@/lib/require-module-page";
import { AdvisorDetailView } from "@/app/app/ekip/[id]/advisor-view";
import { SkeletonCard } from "@/components/ui/viz";
import { CoachInsightSlot } from "@/app/app/danisman-kpi/coach-insight-slot";
import { PersonalGoal } from "./personal-goal";

export const metadata = { title: "Performansım" };

/**
 * Performansım: kişinin KENDİ karnesi, hedefi ve kazancı tek sekmeli görünümde. Danışman rolünde Ekip Merkezi
 * yerine bu giriş vardır. Gövde `/app/ekip/[id]` ile ortaktır (Danışman 360, kendi profili); paket kapısı yoktur
 * (Danışman paketinde de açık), başkasının verisi sunucudan hiç çekilmez (`loadAdvisorMetrics` kapsamı).
 *
 * Üstte kişisel hedef halkası (Suspense akışı; hedef yoksa hiçbir şey çizilmez) ve koçluk içgörüsü yeri
 * (içgörü okuyucusu bağlanana dek boş; sahte içgörü üretilmez).
 */
export default async function PerformansimPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireModulePage("dashboard");
  const sp = (await searchParams) ?? {};
  return (
    <div className="space-y-6">
      <Suspense fallback={<SkeletonCard height={168} label="Hedef yükleniyor" />}>
        <PersonalGoal userId={auth.userId} role={auth.role} tenantId={auth.tenantId} perms={auth.perms} />
      </Suspense>
      <CoachInsightSlot />
      <AdvisorDetailView memberId={auth.userId} basePath="/app/performansim" searchParams={sp} auth={auth} />
    </div>
  );
}
