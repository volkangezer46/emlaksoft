import Link from "@/components/ui/smart-link";
import { headers } from "next/headers";
import { Globe, History, KeyRound, MonitorSmartphone, ShieldAlert, ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { DEMO_MODE_LABELS, getDemoPolicyNow, type DemoMode } from "@/lib/platform-security/demo-policy";
import { getPlatformMfaPolicyNow } from "@/lib/platform-security/mfa-policy";
import { DAY_MS } from "@/lib/clock";
import { listStaffMfaStatus } from "@/app/actions/platform-security";
import { CopyLine, DemoModeForm, MfaEnforcementForm } from "./security-forms";
import { AccessPolicyForm, RevokeSessionButton } from "./access-policy-forms";
import { createClient } from "@/lib/supabase/server";
import { clientIpFrom } from "@/lib/platform-activity";
import { ipMatches, parseAllowlist } from "@/lib/platform-security/admin-access";
import {
  countActiveSuperAdmins,
  loadAccessPolicy,
  loadImpersonationHistory,
  loadStaffSessions,
} from "@/lib/platform-security/security-overview";
import { formatDurationTr } from "@/lib/ops/restore-drill-status";

export const metadata = { title: "Güvenlik politikası" };

const DATE = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });
const ENV_FILE = "/root/emlaksoft/.env.production";
const envHint = (vars: string) => `${ENV_FILE} içinde ${vars} yapıp yeniden yayınlayın (bash scripts/sunucu/deploy.sh).`;

/** Tarayıcı + işletim sistemi kısa adı (oturum listesi; tam metin title'da). */
function shortUa(ua: string | null): string {
  if (!ua) return "Bilinmeyen cihaz";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Tarayıcı";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

function StatusTile({ label, value, tone, href }: { label: string; value: string; tone: "ok" | "danger" | "warn" | "muted"; href: string }) {
  const cls = tone === "ok" ? "text-mint-600" : tone === "danger" ? "text-danger-600" : tone === "warn" ? "text-amber-700" : "text-ink-950";
  return (
    <Link href={href} className="focus-ring rounded-[var(--radius-card)] border border-line bg-canvas p-3 transition hover:border-brand-300">
      <span className="block text-xs text-text-faint">{label}</span>
      <span className={`block font-semibold ${cls}`}>{value}</span>
    </Link>
  );
}

/**
 * Personel > Güvenlik politikası: demo girişi anahtarı (env tavanı altında, süreli platform demosu) ve personel MFA
 * zorunluluğu. Yazma yalnız süper admin (eylemler sunucuda yeniden denetler); diğer roller durumu görür.
 */
export default async function SecurityPolicyPage() {
  const staff = await requirePlatformModule("personel");
  const supabase = await createClient();
  const [demo, mfa, mfaStatus, policy, sessions, history, superAdmins, claims, h] = await Promise.all([
    getDemoPolicyNow(),
    getPlatformMfaPolicyNow(),
    listStaffMfaStatus(),
    loadAccessPolicy(),
    loadStaffSessions(),
    loadImpersonationHistory(50),
    countActiveSuperAdmins(),
    supabase.auth.getClaims(),
    headers(),
  ]);
  const currentSessionId = typeof claims.data?.claims?.session_id === "string" ? claims.data.claims.session_id : null;
  const currentIp = clientIpFrom(h);
  const currentIpAllowed = policy.ruleCount === 0 || ipMatches(parseAllowlist(policy.allowlistRaw).rules, currentIp);
  const activeStaff = Object.values(mfaStatus).filter((v) => v && v.active);
  const mfaCovered = activeStaff.filter((v) => v && v.verified > 0).length;
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

      <section aria-labelledby="guvenlik-durumu" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 id="guvenlik-durumu" className="font-display font-bold text-ink-950">Güvenlik durumu</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <StatusTile
            label="MFA kapsamı (aktif personel)"
            value={`${mfaCovered} / ${activeStaff.length}`}
            tone={activeStaff.length > 0 && mfaCovered === activeStaff.length ? "ok" : "danger"}
            href="#mfa"
          />
          <StatusTile
            label="Şifreli yedek"
            value={policy.backup ? (policy.backup.encrypted ? "Evet (.age)" : "Hayır") : "Bilgi yok"}
            tone={policy.backup ? (policy.backup.encrypted ? "ok" : "danger") : "muted"}
            href="/admin/sistem#yedek"
          />
          <StatusTile
            label="Uzak kopya"
            value={policy.backup ? (policy.backup.remote ? "Evet" : "Hayır") : "Bilgi yok"}
            tone={policy.backup ? (policy.backup.remote ? "ok" : "danger") : "muted"}
            href="/admin/sistem#yedek"
          />
          <StatusTile
            label="Geri yükleme tatbikatı"
            value={policy.drill ? `${policy.drill.ok ? "Başarılı" : "Başarısız"} · ${DATE.format(new Date(policy.drill.at))}` : "Henüz yapılmadı"}
            tone={policy.drill ? (policy.drill.ok ? "ok" : "danger") : "warn"}
            href="/admin/sistem#yedek"
          />
          <StatusTile
            label="Aktif süper admin"
            value={superAdmins === null ? "?" : String(superAdmins)}
            tone={superAdmins === null ? "muted" : superAdmins > 3 ? "warn" : "ok"}
            href="/admin/personel"
          />
          <StatusTile
            label="Yönetim IP izin listesi"
            value={policy.ruleCount ? `${policy.ruleCount} kural` : "Kapalı (her IP)"}
            tone={policy.ruleCount ? "ok" : "warn"}
            href="#erisim"
          />
          <StatusTile
            label="Oturum: boşta / en uzun"
            value={`${policy.idleMinutes ? `${policy.idleMinutes} dk` : "kapalı"} / ${policy.maxHours ? `${policy.maxHours} sa` : "sınırsız"}`}
            tone="muted"
            href="#erisim"
          />
          <StatusTile
            label="Kritik işlemde TOTP"
            value={policy.stepUp ? "Açık" : "Kapalı"}
            tone={policy.stepUp ? "ok" : "danger"}
            href="#erisim"
          />
        </div>
      </section>

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

      <section id="mfa" className="scroll-mt-24 space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
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
            {mfa.enforced ? (
              <p className="mt-1 text-xs text-text-muted">
                Geçiş süresi yalnız panel girişini kapsar; veritabanı kapılı işlemler (ör. büyüme ekranları) süre içinde de
                doğrulayıcı ister.
              </p>
            ) : null}
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

      <section id="erisim" className="scroll-mt-24 space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <Globe className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-ink-950">Yönetim erişim politikası</h2>
            <p className="text-xs text-text-muted">
              IP izin listesi /admin ve /api/admin isteklerinde kimlikten önce uygulanır (listede olmayan IP 403 alır). Boşta kalma
              ve oturum ömrü dolunca personel yeniden giriş yapar. Şu anki IP&apos;niz: <strong className="text-ink-950">{currentIp ?? "bilinmiyor"}</strong>
              {policy.ruleCount ? (currentIpAllowed ? " (listede)" : " (LİSTEDE DEĞİL)") : ""}.
            </p>
          </div>
        </div>
        {isSuper ? (
          <AccessPolicyForm
            initial={{ allowlist: policy.allowlistRaw, idleMinutes: policy.idleMinutes, maxHours: policy.maxHours, stepUp: policy.stepUp }}
            currentIp={currentIp}
          />
        ) : (
          <p className="text-xs text-text-muted">Değiştirmek için süper admin yetkisi gerekir.</p>
        )}
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer font-semibold text-ink-900">Acil durum kurtarma (IP listesi dışında kaldıysanız)</summary>
          <div className="mt-2 space-y-2">
            <p>
              Süper admin izin listesi yüzünden panele giremiyorsa sunucuda iki yoldan biri: (1) listeyi veritabanından silin (en geç 30
              sn içinde etkin), ya da (2) ortam değişkeniyle listeyi geçici olarak devre dışı bırakıp yeniden yayınlayın. Sonra
              doğru listeyi bu ekrandan girip (2) yaptıysanız değişkeni kaldırın.
            </p>
            <CopyLine text={`docker exec supabase-db-moqbebljyeyprktd19zb1ihn psql -U postgres -d postgres -c "delete from platform_settings where key='platform.admin_ip_allowlist';"`} />
            <CopyLine text={envHint("ADMIN_IP_ALLOWLIST=off")} />
          </div>
        </details>
      </section>

      <section id="oturumlar" className="scroll-mt-24 space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-ink-950">Personel aktif oturumları ({sessions.rows.length})</h2>
            <p className="text-xs text-text-muted">Kapatılan oturumun yenileme anahtarı hemen geçersiz olur; açık sayfa en geç bir saat içinde yeniden giriş ister.</p>
          </div>
        </div>
        {sessions.pending ? (
          <p className="text-xs text-text-muted">Oturum listesi veritabanı güncellemesinden sonra görünür.</p>
        ) : sessions.rows.length === 0 ? (
          <p className="text-xs text-text-muted">Açık personel oturumu yok.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {sessions.rows.map((r) => {
              const current = r.sessionId === currentSessionId;
              return (
                <li key={r.sessionId} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Link href={`/admin/personel/${r.userId}`} className="font-semibold text-ink-950 hover:text-brand-600">
                      {r.name}
                    </Link>
                    {current ? <span className="ml-2 rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-700">Bu oturum</span> : null}
                    <p className="text-xs text-text-muted" title={r.userAgent ?? undefined}>
                      {shortUa(r.userAgent)} · {r.ip ?? "IP yok"} · {r.aal === "aal2" ? "doğrulayıcıyla" : "yalnız parola"}
                      {r.createdAt ? ` · giriş ${DATE.format(new Date(r.createdAt))}` : ""}
                      {r.lastSeenAt ? ` · son yenileme ${DATE.format(new Date(r.lastSeenAt))}` : ""}
                    </p>
                  </div>
                  {isSuper ? <RevokeSessionButton sessionId={r.sessionId} label={r.name} current={current} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="destek-erisimi" className="scroll-mt-24 space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <History className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-ink-950">Destek erişimi geçmişi (son {history.rows.length})</h2>
            <p className="text-xs text-text-muted">
              &quot;Ofise gir&quot; oturumları: gerekçe ve bilet no zorunludur; ofis sahibi aynı kaydı kendi denetim günlüğünde
              &quot;EmlakSoft destek erişimi&quot; olarak görür.
            </p>
          </div>
        </div>
        {history.pending ? (
          <p className="text-xs text-text-muted">Geçmiş veritabanı güncellemesinden sonra tutulmaya başlar.</p>
        ) : history.rows.length === 0 ? (
          <p className="text-xs text-text-muted">Henüz destek erişimi yapılmadı.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {history.rows.map((r) => {
              const status = r.endedAt
                ? `bitti ${DATE.format(new Date(r.endedAt))} (${formatDurationTr(Math.max(0, Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)))})`
                : new Date(r.expiresAt).getTime() < mfa.nowMs
                  ? "süresi doldu"
                  : "sürüyor";
              return (
                <li key={r.id} className="space-y-0.5 px-3.5 py-2.5 text-sm">
                  <p className="flex flex-wrap items-center gap-x-2">
                    <span className="font-semibold text-ink-950">{r.staffName}</span>
                    <span className="text-text-muted">→</span>
                    {r.tenantId ? (
                      <Link href={`/admin/tenants/${r.tenantId}`} className="font-semibold text-brand-600 hover:underline">
                        {r.tenantName}
                      </Link>
                    ) : (
                      <span className="text-text-muted">{r.tenantName}</span>
                    )}
                    <span className="rounded-full bg-ink-950/6 px-2 py-0.5 text-xs font-semibold text-ink-900">Bilet {r.ticketId}</span>
                  </p>
                  <p className="text-xs text-text-muted">
                    {DATE.format(new Date(r.startedAt))} · {status} · {r.reason}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
