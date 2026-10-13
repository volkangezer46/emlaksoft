import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageTabs } from "@/components/app/page-tabs";
import { requirePlatformStaffForAccount } from "@/lib/platform";
import { PLATFORM_ROLE_LABELS } from "@/lib/platform-access";
import { createClient } from "@/lib/supabase/server";
import { AvatarEditor } from "@/components/app/avatar-editor";
import { removeStaffAvatar, setStaffAvatarPreset, uploadStaffAvatar } from "@/app/actions/platform-avatar";
import { OwnPasswordForm, OwnProfileForm } from "./account-forms";
import { SecurityPanel, type OwnFactor } from "./security-panel";
import { getPlatformMfaPolicyNow } from "@/lib/platform-security/mfa-policy";

export const metadata = { title: "Hesabım" };

const TABS = [
  { id: "profil", label: "Profil", icon: UserRound },
  { id: "parola", label: "Parola", icon: KeyRound },
  { id: "guvenlik", label: "Güvenlik", icon: ShieldCheck },
] as const;

const GRACE_DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });

/** Güvenlik sekmesi verisi: kendi doğrulanmış TOTP faktörleri + oturum düzeyi (kullanıcı oturumu; service_role yok). */
async function loadOwnSecurity() {
  const supabase = await createClient();
  const [factors, aal, policy] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    getPlatformMfaPolicyNow(),
  ]);
  const own: OwnFactor[] = (factors.data?.totp ?? [])
    .filter((f) => f.status === "verified")
    .map((f) => ({ id: f.id, name: f.friendly_name || "Authenticator", createdAt: f.created_at }));
  const requiredText = !policy.enforced
    ? "Personel için şu an zorunlu değil; yine de kurmanız önerilir."
    : policy.graceActive && policy.graceUntil
      ? `Zorunlu: ${GRACE_DATE.format(new Date(policy.graceUntil))} itibarıyla doğrulayıcısı olmayan personel giriş yapamaz.`
      : "Zorunlu: yönetim paneline her girişte doğrulayıcı kodu istenir.";
  return { own, sessionAal2: aal.data?.currentLevel === "aal2", requiredText };
}

/**
 * Personelin kendi hesabı: ad soyad ve parola. Her aktif personel erişir (modül kapısı yok);
 * hedef daima oturumdaki kullanıcıdır (başkasının hesabına dokunulamaz).
 */
export default async function AdminAccountPage({
  searchParams,
}: {
  searchParams?: Promise<{ sekme?: string }>;
}) {
  const staff = await requirePlatformStaffForAccount();
  const sekme = (await searchParams)?.sekme;
  const active = sekme === "parola" ? "parola" : sekme === "guvenlik" ? "guvenlik" : "profil";
  // Avatar alanları kimlik önbelleğinde yok; yalnız profil sekmesinde, kendi satırı (RLS: platform_staff_self_select).
  const avatar =
    active === "profil"
      ? (
          await (await createClient())
            .from("platform_staff")
            .select("avatar_url, avatar_preset")
            .eq("id", staff.id)
            .maybeSingle()
        ).data
      : null;
  const security = active === "guvenlik" ? await loadOwnSecurity() : null;

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
      ) : security ? (
        <SecurityPanel factors={security.own} sessionAal2={security.sessionAal2} mfaRequiredText={security.requiredText} />
      ) : (
        <>
          <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
            <div>
              <h2 className="font-display font-bold text-ink-950">Profil fotoğrafı</h2>
              <p className="text-xs text-text-muted">Fotoğrafınızı yükleyin veya hazır bir avatar seçin; panelde adınızın yanında görünür.</p>
            </div>
            <AvatarEditor
              name={staff.full_name}
              avatarUrl={avatar?.avatar_url ?? null}
              avatarPreset={avatar?.avatar_preset ?? null}
              actions={{ upload: uploadStaffAvatar, preset: setStaffAvatarPreset, remove: removeStaffAvatar }}
            />
          </section>
          <OwnProfileForm fullName={staff.full_name} email={staff.email} roleLabel={PLATFORM_ROLE_LABELS[staff.role]} />
        </>
      )}
    </div>
  );
}
