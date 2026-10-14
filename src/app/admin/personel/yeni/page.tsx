import { requirePlatformModule } from "@/lib/platform";
import { StaffForm } from "./staff-form";

export const metadata = { title: "Yeni personel" };

export default async function YeniPersonelPage() {
  await requirePlatformModule("personel");
  return <StaffForm />;
}
