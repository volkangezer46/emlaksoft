import { requirePlatformModule } from "@/lib/platform";
import { StaffDetailView } from "./staff-detail-view";

export const metadata = { title: "Personel ayrıntısı" };

/** Personel ayrıntısı: kapı sunucuda; kayıt, özel rol ve aktivite istemcide (/api/admin/personel?id=). */
export default async function PersonelDetayPage() {
  await requirePlatformModule("personel");
  return <StaffDetailView />;
}
