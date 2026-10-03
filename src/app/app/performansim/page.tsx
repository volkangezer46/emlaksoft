import { requireModulePage } from "@/lib/require-module-page";
import { AdvisorDetailView } from "@/app/app/ekip/[id]/advisor-view";

export const metadata = { title: "Performansım" };

/**
 * Performansım: kişinin KENDİ karnesi, hedefi ve kazancı tek sekmeli görünümde. Danışman rolünde Ekip Merkezi
 * yerine bu giriş vardır. Gövde `/app/ekip/[id]` ile ortaktır (Danışman 360, kendi profili); paket kapısı yoktur
 * (Danışman paketinde de açık), başkasının verisi sunucudan hiç çekilmez (`loadAdvisorMetrics` kapsamı).
 */
export default async function PerformansimPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireModulePage("dashboard");
  const sp = (await searchParams) ?? {};
  return <AdvisorDetailView memberId={auth.userId} basePath="/app/performansim" searchParams={sp} auth={auth} />;
}
