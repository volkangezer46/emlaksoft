import { BellRing, Database, Landmark, Megaphone, Radar, Server, Workflow } from "lucide-react";
import { PageTabs } from "@/components/app/page-tabs";
import { requirePlatformModule } from "@/lib/platform";
import { ErrorsView } from "./_hatalar/errors-view";
import { EmlakFiyatiView } from "./emlakfiyati-view";
import { PortalRulesView } from "./portal-rules/portal-rules-view";
import { SystemView } from "./system-view";
import { AlertsView } from "./alerts-view";
import { ResourcesView } from "./resources-view";
import { DatabaseView } from "./database-view";
import { StatusPageView } from "./status-page-view";

export const metadata = { title: "Sistem sağlığı" };

/**
 * Sayfa içi pill'ler. "Üretim hataları" pill'i kaldırıldı: bölüm şeridinde aynı yere giden "Hata kayıtları" sekmesi
 * var (iki şeritte kopya sekme). `?sekme=hatalar` derin bağlantısı aynen çalışır (hata listesi açılır).
 */
const TABS = [
  { id: "saglik", label: "Sistem sağlığı", icon: Radar },
  { id: "uyarilar", label: "Uyarılar", icon: BellRing },
  { id: "durum", label: "Durum sayfası", icon: Megaphone },
  { id: "kaynaklar", label: "Kaynaklar", icon: Server },
  { id: "veritabani", label: "Veritabanı", icon: Database },
  { id: "emlakfiyati", label: "EmlakFiyati", icon: Landmark },
  { id: "portal-kurallari", label: "Portal kuralları", icon: Workflow },
] as const;

/**
 * Sistem sağlığı + Üretim hataları tek sayfada (hata listesi bileşenleri `./_hatalar`).
 * İki sekme de aynı `sistem` platform modülündedir (tek kapı).
 * `?sekme=hatalar` hata listesini açar; durum/son/sayfa parametreleri ona aittir.
 * `?sekme=portal-kurallari` portal form kurallarını açar; `portal` ve `gorunum` parametreleri ona aittir.
 * `?sekme=uyarilar|kaynaklar|veritabani` operasyon merkezi (AD10); `olay=tumu` uyarı günlüğü süzgeci,
 * `is=<cron işi>` sağlık sekmesinde o işin son 30 çalışmasını (süre grafiği) açar.
 * `?sekme=durum` kamuya açık /durum sayfasının olay/bakım yönetimi ve sürüm (deploy) geçmişi (DG5); `yayin=<sha>` hata listesini o sürüme süzer.
 */
export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string; durum?: string; son?: string; sayfa?: string; q?: string; kaynak?: string; ofis?: string; portal?: string; gorunum?: string; olay?: string; is?: string; yayin?: string }>;
}) {
  await requirePlatformModule("sistem");
  const sp = (await searchParams) ?? {};
  const KNOWN = ["hatalar", "emlakfiyati", "portal-kurallari", "uyarilar", "kaynaklar", "veritabani", "durum"] as const;
  const active = (KNOWN as readonly string[]).includes(sp.sekme ?? "") ? (sp.sekme as (typeof KNOWN)[number]) : "saglik";

  return (
    <div className="space-y-6">
      <PageTabs base="/admin/sistem" label="Sistem sekmeleri" tabs={TABS} active={active} />
      {active === "hatalar" ? (
        <ErrorsView searchParams={Promise.resolve(sp)} />
      ) : active === "emlakfiyati" ? (
        <EmlakFiyatiView />
      ) : active === "portal-kurallari" ? (
        <PortalRulesView portal={sp.portal} view={sp.gorunum} />
      ) : active === "uyarilar" ? (
        <AlertsView filter={sp.olay} />
      ) : active === "kaynaklar" ? (
        <ResourcesView />
      ) : active === "veritabani" ? (
        <DatabaseView />
      ) : active === "durum" ? (
        <StatusPageView />
      ) : (
        <SystemView cronJob={sp.is} />
      )}
    </div>
  );
}
