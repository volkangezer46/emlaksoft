import { Landmark, Radar, Workflow } from "lucide-react";
import { PageTabs } from "@/components/app/page-tabs";
import { requirePlatformModule } from "@/lib/platform";
import { ErrorsView } from "../hatalar/errors-view";
import { EmlakFiyatiView } from "./emlakfiyati-view";
import { PortalRulesView } from "./portal-rules/portal-rules-view";
import { SystemView } from "./system-view";

export const metadata = { title: "Sistem sağlığı" };

/**
 * Sayfa içi pill'ler. "Üretim hataları" pill'i kaldırıldı: bölüm şeridinde aynı yere giden "Hata kayıtları" sekmesi
 * var (iki şeritte kopya sekme). `?sekme=hatalar` derin bağlantısı aynen çalışır (hata listesi açılır).
 */
const TABS = [
  { id: "saglik", label: "Sistem sağlığı", icon: Radar },
  { id: "emlakfiyati", label: "EmlakFiyati", icon: Landmark },
  { id: "portal-kurallari", label: "Portal kuralları", icon: Workflow },
] as const;

/**
 * Sistem sağlığı + Üretim hataları (eski /admin/hatalar) tek sayfada.
 * İki sekme de aynı `sistem` platform modülündedir (tek kapı).
 * `?sekme=hatalar` hata listesini açar; durum/son/sayfa parametreleri ona aittir.
 * `?sekme=portal-kurallari` portal form kurallarını açar; `portal` ve `gorunum` parametreleri ona aittir.
 */
export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string; durum?: string; son?: string; sayfa?: string; q?: string; kaynak?: string; ofis?: string; portal?: string; gorunum?: string }>;
}) {
  await requirePlatformModule("sistem");
  const sp = (await searchParams) ?? {};
  const active =
    sp.sekme === "hatalar"
      ? "hatalar"
      : sp.sekme === "emlakfiyati"
        ? "emlakfiyati"
        : sp.sekme === "portal-kurallari"
          ? "portal-kurallari"
          : "saglik";

  return (
    <div className="space-y-6">
      <PageTabs base="/admin/sistem" label="Sistem sekmeleri" tabs={TABS} active={active} />
      {active === "hatalar" ? (
        <ErrorsView searchParams={Promise.resolve(sp)} />
      ) : active === "emlakfiyati" ? (
        <EmlakFiyatiView />
      ) : active === "portal-kurallari" ? (
        <PortalRulesView portal={sp.portal} view={sp.gorunum} />
      ) : (
        <SystemView />
      )}
    </div>
  );
}
