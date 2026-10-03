import { Megaphone } from "lucide-react";
import { PageTabs, type PageTab } from "@/components/app/page-tabs";
import { ICONS } from "@/lib/icons";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { AnnouncementsView } from "../ayarlar/duyurular/announcements-view";
import { NotificationsView } from "./notifications-view";

export const metadata = { title: "Bildirimler" };

type Sp = { sekme?: string; durum?: string; tur?: string; sayfa?: string };

/**
 * Bildirimler: kişisel bildirim akışı + ofis duyuruları (eski /app/ayarlar/duyurular).
 * Duyuru yönetimi `settings` iznine bağlıdır: izin yoksa sekme gizlenir.
 */
export default async function NotificationsPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  const { perms } = await requireModulePage("dashboard");
  const sp = (await searchParams) ?? {};
  const canAnnounce = effectiveCanAccessModule(perms, "settings");
  const active = canAnnounce && sp.sekme === "duyurular" ? "duyurular" : "bildirimler";
  const tabs: PageTab[] = [{ id: "bildirimler", label: "Bildirimler", icon: ICONS.bildirim }];
  if (canAnnounce) tabs.push({ id: "duyurular", label: "Ofis duyuruları", icon: Megaphone });

  return (
    <div className="space-y-6">
      <PageTabs base="/app/bildirimler" label="Bildirim sekmeleri" tabs={tabs} active={active} />
      {active === "duyurular" ? <AnnouncementsView /> : <NotificationsView searchParams={Promise.resolve(sp)} />}
    </div>
  );
}
