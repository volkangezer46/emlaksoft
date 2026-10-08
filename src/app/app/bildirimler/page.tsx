import { Megaphone, Settings2 } from "lucide-react";
import { PageTabs, type PageTab } from "@/components/app/page-tabs";
import { ICONS } from "@/lib/icons";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { AnnouncementsView } from "../ayarlar/duyurular/announcements-view";
import { DuyuruAkisi } from "./duyuru-akisi";
import { NotificationsView } from "./notifications-view";

export const metadata = { title: "Bildirimler" };

type Sp = { sekme?: string; durum?: string; tur?: string; sayfa?: string };

/**
 * Bildirimler: kişisel bildirim akışı + ofis duyuruları (herkes okur; ana ekrandaki duyuru satırı buraya taşındı) +
 * duyuru yönetimi (eski /app/ayarlar/duyurular). Yönetim `settings` iznine bağlıdır: izin yoksa sekme gizlenir.
 */
export default async function NotificationsPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  const { perms } = await requireModulePage("dashboard");
  const sp = (await searchParams) ?? {};
  const canAnnounce = effectiveCanAccessModule(perms, "settings");
  const active = sp.sekme === "duyurular" ? "duyurular" : canAnnounce && sp.sekme === "yonetim" ? "yonetim" : "bildirimler";
  const tabs: PageTab[] = [
    { id: "bildirimler", label: "Bildirimler", icon: ICONS.bildirim },
    { id: "duyurular", label: "Duyurular", icon: Megaphone },
  ];
  if (canAnnounce) tabs.push({ id: "yonetim", label: "Duyuru yönetimi", icon: Settings2 });

  return (
    <div className="space-y-6">
      <PageTabs base="/app/bildirimler" label="Bildirim sekmeleri" tabs={tabs} active={active} />
      {active === "duyurular" ? <DuyuruAkisi /> : active === "yonetim" ? <AnnouncementsView /> : <NotificationsView searchParams={Promise.resolve(sp)} />}
    </div>
  );
}
