import Link from "@/components/ui/smart-link";
import { KeyRound, ShieldCheck, UserRound, Bell, MonitorSmartphone, LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { DetailTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { NotificationPrefsPanel } from "@/components/app/notification-prefs";
import { getNotificationPrefs } from "@/app/actions/notification-prefs";
import { loadNotificationChannels } from "@/lib/notification-channels";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { formatDateTimeTr } from "@/lib/format";
import { deviceLabel, summarizeDevices } from "@/lib/account/device-label";
import { Alert } from "@/components/ui/alert";
import { loadOwnProfileAvatar } from "@/lib/avatar-read";
import { AvatarEditor } from "@/components/app/avatar-editor";
import { removeOwnAvatar, setOwnAvatarPreset, uploadOwnAvatar } from "@/app/actions/avatar";
import { EmailChangeForm, OtherDevicesForm, PasswordForm, ProfileForm } from "./account-forms";
import { GoogleIdentityCard } from "./google-identity-card";
import { ModuleVisibility } from "./module-visibility";
import { getTenantModuleState } from "@/lib/modules/state";
import { getUserHiddenModules } from "@/lib/modules/prefs";
import { googleErrorMessage, isGoogleAuthEnabled } from "@/lib/auth/google-auth";

export const metadata = { title: "Hesabım" };

const RESULT_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  success: { label: "Başarılı", variant: "success" },
  failed: { label: "Başarısız", variant: "danger" },
  "2fa_pending": { label: "2FA bekliyor", variant: "warning" },
  "2fa_failed": { label: "2FA hatalı", variant: "danger" },
};

const TABS: DetailTabDef[] = [
  { id: "profil", label: "Profil", icon: UserRound },
  { id: "parola", label: "Parola", icon: KeyRound },
  { id: "oturumlar", label: "Oturumlar", icon: MonitorSmartphone },
  { id: "bildirimler", label: "Bildirimler", icon: Bell },
  { id: "gorunum", label: "Görünüm", icon: LayoutGrid },
];

/** Kullanıcının kendi hesabı: profil, parola, oturumlar, bildirim tercihleri, 2FA bağlantısı. */
export default async function AccountPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireModulePage("dashboard");
  const user = await getRequestUser();
  const sp = (await searchParams) ?? {};
  const active = resolveTab(sp, TABS.map((t) => t.id), "profil");
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone, title, two_factor_sms")
    .eq("id", auth.userId)
    .maybeSingle();

  // Avatar sütunları ayrı ve hata-toleranslı okunur (migration gecikse bile profil formu bozulmaz).
  const avatar = active === "profil" ? await loadOwnProfileAvatar(auth.userId) : null;
  const canSecurityPage = effectiveCanAccessModule(auth.perms, "settings");
  const events =
    active === "oturumlar"
      ? ((
          await supabase
            .from("login_events")
            .select("id, ip, user_agent, result, created_at")
            .eq("user_id", auth.userId)
            .order("created_at", { ascending: false })
            .limit(40)
        ).data ?? [])
      : [];
  const devices = summarizeDevices(events);
  // Google bağlama dönüşü (/auth/callback?akis=link → ?google=baglandi | hata kodu).
  const googleEnabled = isGoogleAuthEnabled();
  const googleParam = typeof sp.google === "string" ? sp.google : null;
  const googleNotice: { tone: "success" | "danger"; text: string } | null = !googleParam
    ? null
    : googleParam === "baglandi"
      ? { tone: "success", text: "Google hesabınız bağlandı. Artık giriş sayfasında \"Google ile devam et\" ile girebilirsiniz." }
      : googleErrorMessage(googleParam)
        ? { tone: "danger", text: googleErrorMessage(googleParam)! }
        : null;
  const prefs = active === "bildirimler" ? await getNotificationPrefs() : undefined;
  const channels = active === "bildirimler" ? await loadNotificationChannels(auth.tenantId) : undefined;
  const officeClosed = active === "gorunum" && auth.tenantId ? (await getTenantModuleState(auth.tenantId)).closed : [];
  const hiddenModules = active === "gorunum" && auth.tenantId ? await getUserHiddenModules(auth.userId, auth.tenantId) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hesabım"
        description="Kendi profiliniz, parolanız, oturumlarınız, bildirim ve görünüm tercihleriniz."
        className="mb-0"
      />
      <DetailTabs basePath="/app/hesabim" tabs={TABS} active={active} label="Hesap sekmeleri" />

      {active === "profil" && sp.eposta === "onay" ? (
        <Alert tone="success">E-posta değişikliği onaylandı. Bir sonraki girişinizde yeni adresinizi kullanın.</Alert>
      ) : null}

      {active === "profil" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Profil fotoğrafı</CardTitle>
              <CardDescription>Fotoğrafınızı yükleyin veya hazır bir avatar seçin; üst çubukta, ekip ve sıralama listelerinde görünür.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <AvatarEditor
              name={profile?.full_name ?? user?.email ?? "Ben"}
              avatarUrl={avatar?.avatar_url ?? null}
              avatarPreset={avatar?.avatar_preset ?? null}
              actions={{ upload: uploadOwnAvatar, preset: setOwnAvatarPreset, remove: removeOwnAvatar }}
            />
          </CardContent>
        </Card>
      ) : null}

      {active === "profil" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Profil bilgileri</CardTitle>
              <CardDescription>Adınız ve telefonunuz ekip listesinde ve kartvizitte görünür.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ProfileForm
              fullName={profile?.full_name ?? ""}
              phone={profile?.phone ?? null}
              title={profile?.title ?? null}
              email={user?.email ?? ""}
              twoFactorOn={Boolean(profile?.two_factor_sms)}
            />
          </CardContent>
        </Card>
      ) : null}

      {active === "profil" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>E-posta adresini değiştir</CardTitle>
              <CardDescription>Doğrulama bağlantılı güvenli akış; e-posta doğrudan yazılmaz.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <EmailChangeForm email={user?.email ?? ""} />
          </CardContent>
        </Card>
      ) : null}

      {googleNotice ? <Alert tone={googleNotice.tone}>{googleNotice.text}</Alert> : null}

      {active === "parola" && googleEnabled ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Giriş yöntemleri</CardTitle>
              <CardDescription>Google hesabınızı bağlayarak tek tıkla giriş yapın; en az bir giriş yöntemi her zaman kalır.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <GoogleIdentityCard />
          </CardContent>
        </Card>
      ) : null}

      {active === "parola" ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Parola değiştir</CardTitle>
                <CardDescription>Mevcut parolanızı doğrulayarak yenisini belirleyin.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <PasswordForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>İki adımlı doğrulama</CardTitle>
                <CardDescription>{profile?.two_factor_sms ? "SMS ile doğrulama açık." : "SMS ile doğrulama kapalı."}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {canSecurityPage ? (
                <Link href="/app/ayarlar/guvenlik" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline">
                  <ShieldCheck className="h-4 w-4" /> Güvenlik ayarlarını aç
                </Link>
              ) : (
                <p className="text-sm text-text-muted">İki adımlı doğrulamayı ofis yöneticiniz Güvenlik ayarlarından yönetir.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {active === "oturumlar" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Oturum açtığınız cihazlar</CardTitle>
                <CardDescription>
                  Tekil açık oturum listesi sunulamıyor (kimlik servisi vermiyor); aşağıda giriş kayıtlarından
                  türetilen cihaz özeti var. Bu cihaz dışındakileri toplu kapatabilirsiniz.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {devices.length > 0 ? (
                <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
                  {devices.map((d) => (
                    <li key={d.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="font-medium text-text">{d.label}</span>
                      <span className="text-right text-xs text-text-muted">
                        Son giriş {formatDateTimeTr(d.lastSeenAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {d.lastIp ? ` · ${d.lastIp}` : ""} · {d.successCount} giriş
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <OtherDevicesForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Son girişler</CardTitle>
                <CardDescription>Tanımadığınız bir giriş görürseniz parolanızı değiştirin.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-text-muted">Henüz giriş kaydı yok.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {events.slice(0, 8).map((e) => {
                    const badge = RESULT_BADGE[e.result] ?? { label: e.result, variant: "default" as BadgeVariant };
                    return (
                      <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="text-text">
                          {formatDateTimeTr(e.created_at, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          <span className="ml-2 text-xs text-text-muted">
                            {deviceLabel(e.user_agent)}
                            {e.ip ? ` · ${e.ip}` : ""}
                          </span>
                        </span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
              {canSecurityPage ? (
                <Link href="/app/ayarlar/guvenlik" className="mt-3 inline-block text-xs font-semibold text-brand-600 hover:underline">
                  Tüm giriş geçmişi
                </Link>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {active === "bildirimler" ? <NotificationPrefsPanel initial={prefs} channels={channels} /> : null}

      {active === "gorunum" ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Görünüm: modüller</CardTitle>
              <CardDescription>
                Kullanmadığınız modülleri kendi menünüzden, ana ekranınızdan ve aramanızdan gizleyin. Yetkinizi ve ofis
                ayarlarını değiştirmez; verileriniz silinmez.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ModuleVisibility officeClosed={officeClosed} hidden={hiddenModules} canEdit={Boolean(auth.tenantId)} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
