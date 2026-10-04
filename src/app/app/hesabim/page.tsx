import Link from "next/link";
import { KeyRound, ShieldCheck, UserRound, Bell, MonitorSmartphone } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { DetailTabs, resolveTab, type DetailTabDef } from "@/components/app/detail-tabs";
import { NotificationPrefsPanel } from "@/components/app/notification-prefs";
import { getNotificationPrefs } from "@/app/actions/notification-prefs";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { formatDateTimeTr } from "@/lib/format";
import { OtherDevicesForm, PasswordForm, ProfileForm } from "./account-forms";

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

  const canSecurityPage = effectiveCanAccessModule(auth.perms, "settings");
  const events =
    active === "oturumlar"
      ? ((
          await supabase
            .from("login_events")
            .select("id, ip, result, created_at")
            .eq("user_id", auth.userId)
            .order("created_at", { ascending: false })
            .limit(8)
        ).data ?? [])
      : [];
  const prefs = active === "bildirimler" ? await getNotificationPrefs() : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hesabım"
        description="Kendi profiliniz, parolanız, oturumlarınız ve bildirim tercihleriniz."
        className="mb-0"
      />
      <DetailTabs basePath="/app/hesabim" tabs={TABS} active={active} label="Hesap sekmeleri" />

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
                <CardTitle>Açık oturumlar</CardTitle>
                <CardDescription>
                  Tarayıcı oturumlarının tek tek listesi mevcut değil; bu cihaz dışındakileri toplu kapatabilirsiniz.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
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
                  {events.map((e) => {
                    const badge = RESULT_BADGE[e.result] ?? { label: e.result, variant: "default" as BadgeVariant };
                    return (
                      <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="text-text">
                          {formatDateTimeTr(e.created_at, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                          {e.ip ? <span className="ml-2 text-xs text-text-muted">{e.ip}</span> : null}
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

      {active === "bildirimler" ? <NotificationPrefsPanel initial={prefs} /> : null}
    </div>
  );
}
