import { PageTabs, type PageTab } from "@/components/app/page-tabs";
import { ICONS } from "@/lib/icons";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { MatchingView } from "../eslestirme/matching-view";
import { DemandsView } from "./demands-view";

export const metadata = { title: "Talepler" };

/**
 * Talepler: talep listesi + Eşleşme (eski /app/eslestirme) tek sayfada.
 * Eşleşme sekmesi KENDİ `matching` iznine bağlıdır: izin yoksa sekme gizlenir ve
 * `?sekme=eslesme` talep listesine düşer. Eski /app/eslestirme yolu yönlendirir.
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
  il?: string;
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
}>;
}) {
  const { perms } = await requireModulePage("demands", "/app/talepler");
  const sp = await searchParams;
  const canMatch = effectiveCanAccessModule(perms, "matching");
  const active = canMatch && sp.sekme === "eslesme" ? "eslesme" : "talepler";
  const tabs: PageTab[] = [{ id: "talepler", label: "Talepler", icon: ICONS.talep }];
  if (canMatch) tabs.push({ id: "eslesme", label: "Eşleşme", icon: ICONS.eslestirme });
  const rest = Promise.resolve(sp);

  return (
    <div className="space-y-6">
      <PageTabs base="/app/talepler" label="Talep sekmeleri" tabs={tabs} active={active} />
      {active === "eslesme" ? <MatchingView searchParams={rest} /> : <DemandsView searchParams={rest} />}
    </div>
  );
}
