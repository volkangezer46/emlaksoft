import { KeyRound, UserRound } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageTabs } from "@/components/app/page-tabs";
import { requirePlatformStaff } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS } from "@/lib/platform-access";
import { OwnPasswordForm, OwnProfileForm } from "./account-forms";

export const metadata = { title: "Hesabım" };

const TABS = [
  { id: "profil", label: "Profil", icon: UserRound },
  { id: "parola", label: "Parola", icon: KeyRound },
] as const;

/**
 * Personelin kendi hesabı: ad soyad ve parola. Her aktif personel erişir (modül kapısı yok);
 * hedef daima oturumdaki kullanıcıdır (başkasının hesabına dokunulamaz).
 */
export default async function AdminAccountPage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string }>;
}) {
  const staff = await requirePlatformStaff();
  const sekme = (await searchParams)?.sekme;
  const active = sekme === "parola" ? "parola" : "profil";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Hesabım"
        icon={UserRound}
        title={staff.full_name}
        description={`${staff.email} · ${PLATFORM_ROLE_LABELS[staff.role]}`}
      />
      <PageTabs base="/admin/hesabim" label="Hesap sekmeleri" tabs={TABS} active={active} />
      {active === "parola" ? (
        <OwnPasswordForm />
      ) : (
        <OwnProfileForm fullName={staff.full_name} email={staff.email} roleLabel={PLATFORM_ROLE_LABELS[staff.role]} />
      )}
    </div>
  );
}
