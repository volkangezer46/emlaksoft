import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";

export const metadata = { title: "Duyurular" };

/** ESKİ YOL: ofis duyuruları artık Bildirimler'in "Ofis duyuruları" sekmesidir (kapı: `settings`). */
export default async function AnnouncementsRedirectPage() {
  await requireModulePage("settings");
  redirect("/app/bildirimler?sekme=duyurular");
}
