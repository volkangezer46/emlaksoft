import Link from "@/components/ui/smart-link";
import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { DEMO_MODE_LABELS, getDemoPolicyNow, type DemoMode } from "@/lib/platform-security/demo-policy";
import { getPlatformMfaPolicyNow } from "@/lib/platform-security/mfa-policy";
import { DAY_MS } from "@/lib/clock";
import { listStaffMfaStatus } from "@/app/actions/platform-security";
import { PersonelTabs } from "../personel-tabs";
import { CopyLine, DemoModeForm, MfaEnforcementForm } from "./security-forms";

export const metadata = { title: "Güvenlik politikası" };

const DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });
const ENV_FILE = "/root/emlaksoft/.env.production";
const envHint = (vars: string) => `${ENV_FILE} içinde ${vars} yapıp yeniden yayınlayın (bash scripts/sunucu/deploy.sh).`;

/**
 * Personel > Güvenlik politikası: demo girişi anahtarı (env tavanı altında, süreli platform demosu) ve personel MFA
 * zorunluluğu. Yazma yalnız süper admin (eylemler sunucuda yeniden denetler); diğer roller durumu görür.
 */
export default async function SecurityPolicyPage() {
  const staff = await requirePlatformModule("personel");
  const [demo, mfa, mfaStatus] = await Promise.all([getDemoPolicyNow(), getPlatformMfaPolicyNow(), listStaffMfaStatus()]);
  const isSuper = staff.role === "super_admin";
  const own = mfaStatus[staff.id];
  const withoutMfa = Object.entries(mfaStatus)
    .filter(([, v]) => v && v.active && v.verified === 0)
    .map(([id, v]) => ({ id, name: v!.name || v!.email, email: v!.email }));
  const unreadable = Object.values(mfaStatus).filter((v) => v === null).length;

  const currentMode: DemoMode | "default" = demo.row?.mode ?? "default";
  const options = [
    {
      value: "default" as const,
      label: "Sunucu varsayılanı",
      hint: `Satır yok: sunucu ortamı ne açtıysa o (${demo.ceiling.platform ? "ofis + platform kartları" : demo.ceiling.tenant ? "yalnız ofis kartları" : "kapalı"}).`,
      disabledText: null,
    },
    { value: "off" as const, label: DEMO_MODE_LABELS.off, hint: "Giriş sayfasında hiçbir demo kartı görünmez.", disabledText: null },
    {
      value: "tenant" as const,
      label: DEMO_MODE_LABELS.tenant,
      hint: "Ofis kullanıcısı kartları açık; süper admin kartları kapalı.",
      disabledText: demo.ceiling.tenant ? null : envHint("PRODUCTION_DEMO_LOGIN_OPT_IN=true"),
    },
    {
      value: "tenant_platform" as const,
      label: DEMO_MODE_LABELS.tenant_platform,
      hint: "Süreli (en çok 24 saat). Adresi bilen herkes süper admin olur.",
      disabledText: demo.ceiling.platform
        ? null
        : envHint(demo.ceiling.tenant ? "PRODUCTION_PLATFORM_DEMO_OPT_IN=true" : "PRODUCTION_DEMO_LOGIN_OPT_IN=true ve PRODUCTION_PLATFORM_DEMO_OPT_IN=true"),
    },
  ];
  const graceDaysLeft = mfa.graceActive && mfa.graceUntil ? Math.ceil((new Date(mfa.graceUntil).getTime() - mfa.nowMs) / DAY_MS) : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform personeli"
        icon={ShieldCheck}
        title="Güvenlik politikası"
        description="Hızlı demo girişi ve personel iki adımlı doğrulaması. Her değişiklik gerekçesiyle denetim izine yazılır."
        art="shield"
      />
      <PersonelTabs active="guvenlik" />

      <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-ink-950">Hızlı demo girişi</h2>
            <p className="text-xs text-text-muted">
              Sunucu tavanı: ofis kartları {demo.ceiling.tenant ? "açık" : "kapalı"}, platform kartları {demo.ceiling.platform ? "açık" : "kapalı"}.
              Yönetim anahtarı tavanı aşamaz.
            </p>
          </div>
        </div>
        {demo.platform ? (
          <p role="alert" className="tone-danger rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-bold">
            Platform demo girişi AÇIK — giriş sayfasındaki kartla herkes tek tıkla süper admin olabilir.{" "}
            {demo.row?.until ? `Bitiş: ${DATE.format(new Date(demo.row.until))}.` : "Süre sınırı yok (sunucu varsayılanı)."}
          </p>
        ) : null}
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
            <dt className="text-xs text-text-faint">Ofis kartları</dt>
            <dd className="font-semibold text-ink-950">{demo.tenant ? "Görünür" : "Gizli"}</dd>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
            <dt className="text-xs text-text-faint">Süper admin kartları</dt>
            <dd className="font-semibold text-ink-950">{demo.platform ? "Görünür" : "Gizli"}</dd>
          </div>
          <div className="rounded-[var(--radius-card)] border border-line bg-canvas p-3">
            <dt className="text-xs text-text-faint">Yönetim ayarı</dt>
            <dd className="font-semibold text-ink-950">
              {demo.row ? DEMO_MODE_LABELS[demo.row.mode] : "Yok (sunucu varsayılanı)"}
            </dd>
          </div>
        </dl>
        {isSuper ? (
          <DemoModeForm current={currentMode} options={options} />
        ) : (
          <p className="text-xs text-text-muted">Değiştirmek için süper admin yetkisi gerekir.</p>
        )}
      </section>

      <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-ink-950">Personel iki adımlı doğrulaması (TOTP)</h2>
            <p className="text-xs text-text-muted">
              Durum:{" "}
              <strong className="text-ink-950">
                {mfa.envMode === "force-off" ? "Acil kapatma (sunucu ortamı)" : mfa.enforced ? "Zorunlu" : "Zorunlu değil"}
              </strong>
              {mfa.envMode === "on" ? " · sunucu ortamı tarafından zorunlu tutuluyor" : ""}
              {graceDaysLeft !== null && mfa.graceUntil
                ? ` · geçiş süresi ${DATE.format(new Date(mfa.graceUntil))} tarihinde bitiyor (${graceDaysLeft} gün)`
                : ""}
            </p>
          </div>
        </div>
        {isSuper ? (
          <>
            {!mfa.enforced && !(own && own.verified > 0) ? (
              <p className="tone-warning rounded-[var(--radius-control)] px-3.5 py-2 text-sm">
                Kendinizi kilitlememek için önce{" "}
                <Link href="/admin/hesabim?sekme=guvenlik" className="font-semibold underline">
                  Hesabım &gt; Güvenlik
                </Link>
                &apos;ten doğrulayıcı kurun; sonra zorunlu yapabilirsiniz.
              </p>
            ) : null}
            {mfa.envMode === "on" ? (
              <p className="text-xs text-text-muted">Sunucu ortamı zorunlu tuttuğu için buradan kapatılamaz (PLATFORM_MFA_ENFORCEMENT=on).</p>
            ) : (
              <MfaEnforcementForm enforced={mfa.dbOn} canEnable={Boolean(own && own.verified > 0)} />
            )}
            <details className="text-xs text-text-muted">
              <summary className="cursor-pointer font-semibold text-ink-900">Kilitlenme kurtarması</summary>
              <div className="mt-2 space-y-2">
                <p>Tüm süper adminler doğrulayıcısını kaybederse sunucuda acil kapatma yapın, sonra veritabanı ayarını kapatın:</p>
                <CopyLine text={envHint("PLATFORM_MFA_ENFORCEMENT=force-off")} />
                <CopyLine text="update platform_settings set value='off' where key='platform.mfa_enforced';" />
              </div>
            </details>
          </>
        ) : null}
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Doğrulayıcısı olmayan aktif personel ({withoutMfa.length})</h3>
          {withoutMfa.length === 0 ? (
            <p className="mt-1 text-xs text-text-muted">Tüm aktif personelin doğrulayıcısı kurulu.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {withoutMfa.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
                  <Link href={`/admin/personel/${m.id}`} className="font-semibold text-ink-950 hover:text-brand-600">
                    {m.name}
                  </Link>
                  <span className="truncate text-xs text-text-muted">{m.email}</span>
                </li>
              ))}
            </ul>
          )}
          {unreadable > 0 ? <p className="mt-1 text-xs text-text-faint">{unreadable} personelin doğrulayıcı bilgisi okunamadı.</p> : null}
        </div>
      </section>
    </div>
  );
}
