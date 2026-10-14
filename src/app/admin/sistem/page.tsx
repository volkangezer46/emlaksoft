import type { Metadata } from "next";
import { requirePlatformModule } from "@/lib/platform";
import { ErrorsView } from "./_hatalar/errors-view";
import { SystemView } from "./system-view";
import { AlertsView } from "./alerts-view";
import { ResourcesView } from "./resources-view";
import { DatabaseView } from "./database-view";
import { IntegrationsView } from "./integrations-view";
import { StatusPageView } from "./status-page-view";

type Sp = { sekme?: string; durum?: string; son?: string; sayfa?: string; q?: string; kaynak?: string; ofis?: string; portal?: string; gorunum?: string; olay?: string; is?: string; yayin?: string };

/**
 * Sistem durumu görünümleri. Sekme şeridi TEK kaynaktan (src/lib/admin/nav.ts "Sistem durumu" tabs; kabuktaki
 * AdminSectionTabs); bu sayfa ikinci bir sekme şeridi çizmez. Her görünümün kendi sekme başlığı (<title>) vardır.
 */
const VIEWS = {
  saglik: "Sistem sağlığı",
  entegrasyonlar: "Entegrasyon merkezi",
  hatalar: "Hata kayıtları",
  uyarilar: "Operasyon uyarıları",
  durum: "Durum sayfası",
  kaynaklar: "Sunucu kaynakları",
  veritabani: "Veritabanı",
} as const;
type ViewId = keyof typeof VIEWS;

const viewOf = (sekme: string | undefined): ViewId => (sekme && Object.hasOwn(VIEWS, sekme) ? (sekme as ViewId) : "saglik");

export async function generateMetadata({ searchParams }: { searchParams?: Promise<Sp> }): Promise<Metadata> {
  const sp = (await searchParams) ?? {};
  return { title: VIEWS[viewOf(sp.sekme)] };
}

/**
 * `?sekme=hatalar` hata listesi (durum/son/sayfa/yayin parametreleri ona aittir).
 * `?sekme=entegrasyonlar` entegrasyon merkezi (DG3): kartlar, anahtar formları (OpenAI, portal API + portal kuralları
 * `#portal-kurallari` — `portal` ve `gorunum` parametreleri ona aittir —, SMS/WhatsApp, EmlakFiyatı `#anahtar-emlakfiyati`),
 * EİDS e-posta alımı, ofis bağlantıları ve webhook günlüğü.
 * `?sekme=uyarilar|kaynaklar|veritabani` operasyon merkezi (AD10); `olay=tumu` uyarı günlüğü süzgeci.
 * `?sekme=durum` kamuya açık /durum sayfasının olay/bakım yönetimi ve sürüm (deploy) geçmişi (DG5).
 * Sekmesiz: sağlık (cron nabzı; `is=<cron işi>` o işin son 30 çalışmasını açar). Kayıt ve bakım ayarları Ayarlar
 * merkezindedir (`/admin/ayarlar?kategori=kayit-bakim`).
 */
export default async function AdminSystemPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  await requirePlatformModule("sistem");
  const sp = (await searchParams) ?? {};
  const active = viewOf(sp.sekme);

  return (
    <div className="space-y-6">
      {active === "hatalar" ? (
        <ErrorsView searchParams={Promise.resolve(sp)} />
      ) : active === "entegrasyonlar" ? (
        <IntegrationsView portal={sp.portal} portalView={sp.gorunum} />
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
