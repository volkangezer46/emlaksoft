import { requirePlatformModule } from "@/lib/platform";
import { PersonelView } from "./personel-view";

export const metadata = { title: "Personel" };

/** Personel listesi: kapı sunucuda; liste istemcide (/api/admin/personel). */
export default async function PersonelPage() {
  await requirePlatformModule("personel");
  return <PersonelView />;
}
