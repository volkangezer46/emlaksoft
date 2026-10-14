import type { Metadata } from "next";
import { requirePlatformModule } from "@/lib/platform";
import { ErrorsView } from "./_hatalar/errors-view";
import { SystemView } from "./system-view";
import { AlertsView } from "./alerts-view";
import { ResourcesView } from "./resources-view";
import { DatabaseView } from "./database-view";
import { IntegrationsView } from "./integrations-view";
import { StatusPageView } from "./status-page-view";
import { DataExplorerView } from "./data-explorer-view";

// Veri gezgini sütun süzgeçleri `f_<sütun>` adlarıyla gelir (açık uçlu; yalnız kayıttaki sütunlar yorumlanır).
type Sp = { sekme?: string; durum?: string; son?: string; sayfa?: string; q?: string; kaynak?: string; ofis?: string; portal?: string; gorunum?: string; olay?: string; is?: string; yayin?: string } & Record<
  string,
  string | undefined
>;

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
  veri: "Veri gezgini",
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
 * `?sekme=veri` salt okunur veri gezgini (SN4; `tablo/ofis/f_<sütun>/bas/bit/sayfa/kayit`). Kapısı `sistem` DEĞİL, kendi
 * `veri` modülüdür (varsayılan yalnız süper admin; başka personel özel rolle).
 * `?sekme=durum` kamuya açık /durum sayfasının olay/bakım yönetimi ve sürüm (deploy) geçmişi (DG5).
 * Sekmesiz: sağlık (cron nabzı; `is=<cron işi>` o işin son 30 çalışmasını açar). Kayıt ve bakım ayarları Ayarlar
 * merkezindedir (`/admin/ayarlar?kategori=kayit-bakim`).
 */
export default async function AdminSystemPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  const sp = (await searchParams) ?? {};
  const active = viewOf(sp.sekme);
  if (active === "veri") {
    return (
      <div className="space-y-6">
        <DataExplorerView params={sp} />
      </div>
    );
  }
  await requirePlatformModule("sistem");

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
