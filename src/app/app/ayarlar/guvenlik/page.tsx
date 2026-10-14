import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { Building2, History, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { headers } from "next/headers";
import { officePolicyIp } from "@/lib/office-security/policy";
import { loadOfficePolicyForm, loadOfficeSessions, policyIsActive } from "@/lib/office-security/read";
import { roleLabel } from "@/lib/role-labels";
import { OfficePolicyForm, RevokeOfficeSessionButton } from "./office-policy-form";
import { requireModulePage } from "@/lib/require-module-page";
import { isNetgsmConfigured } from "@/lib/messaging/netgsm";
import { getTenantNetgsmConfig } from "@/lib/messaging/tenant-providers";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { TwoFactorForm } from "./two-factor-form";
import { formatDateTimeTr } from "@/lib/format";

export const metadata = { title: "Güvenlik" };

const RESULT_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  success: { label: "Başarılı", variant: "success" },
  failed: { label: "Başarısız", variant: "danger" },
  "2fa_pending": { label: "2FA bekliyor", variant: "warning" },
  "2fa_failed": { label: "2FA hatalı", variant: "danger" },
};

/** user-agent'tan kısa cihaz etiketi (tam parser gerekmez, ipucu yeter). */
function deviceLabel(ua: string | null): string {
  if (!ua) return "Bilinmiyor";
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Diğer";
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Tarayıcı";
  return `${os} · ${browser}`;
}

function formatDate(iso: string): string {
  return formatDateTimeTr(iso, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function SecuritySettingsPage() {
  const ctx = await requireModulePage("settings");
  const supabase = await createClient();
  // DG7: ofis politikası sahip ve genel müdüre görünür (yalnız sahip düzenler); açık oturumlar yalnız sahibe.
  const tenantId = ctx.tenantId;
  const isOwner = ctx.role === "owner" && Boolean(tenantId);
  const showPolicy = Boolean(tenantId) && (ctx.role === "owner" || ctx.role === "gm");

  const [{ data: profile }, { data: events }, tenantCfg, platformConfigured, officePolicy, officeSessions, currentIp, claims] = await Promise.all([
    supabase.from("profiles").select("two_factor_sms, phone").eq("id", ctx.userId).maybeSingle(),
    supabase
      .from("login_events")
      .select("id, ip, user_agent, result, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.tenantId ? getTenantNetgsmConfig(ctx.tenantId) : Promise.resolve(null),
    isNetgsmConfigured(),
    showPolicy && tenantId ? loadOfficePolicyForm(supabase, tenantId) : Promise.resolve(null),
    isOwner && tenantId ? loadOfficeSessions(createAdminClient(), tenantId) : Promise.resolve(null),
    showPolicy ? headers().then(officePolicyIp) : Promise.resolve(null),
    isOwner ? supabase.auth.getClaims() : Promise.resolve(null),
  ]);
  const currentSessionId = typeof claims?.data?.claims?.session_id === "string" ? claims.data.claims.session_id : null;

  // Kimlik bilgisi client'a gitmez — yalnız var/yok bilgisi kullanılır
  const smsConfigured = tenantCfg !== null || platformConfigured;
  const loginEvents = events ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Güvenlik" }]}
        title="Güvenlik"
        description={showPolicy ? "Hesabınız ve ofisiniz için iki adımlı doğrulama, erişim politikası, açık oturumlar ve giriş geçmişi." : "Hesabınız için iki adımlı doğrulama ve giriş geçmişi."}
        className="mb-0"
      />

      {/* 2FA */}
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-mint-500/12 text-mint-600">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">İki adımlı doğrulama (SMS)</h2>
            <p className="text-xs text-text-muted">
              Açıkken her girişte telefonunuza gönderilen 6 haneli kod istenir.
            </p>
          </div>
        </div>
        <div className="mt-5 max-w-xl">
          <TwoFactorForm
            enabled={Boolean(profile?.two_factor_sms)}
            phone={profile?.phone ?? null}
            smsConfigured={smsConfigured}
          />
        </div>
      </section>

      {/* DG7 ofis güvenlik politikası */}
      {officePolicy ? (
        <section id="ofis-politikasi" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
          <div className="flex items-center gap-3 border-b border-line pb-4">
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display font-bold text-ink-950">Ofis güvenlik politikası</h2>
              <p className="text-xs text-text-muted">
                {policyIsActive(officePolicy)
                  ? "Politika etkin: tüm ofis kullanıcılarına uygulanır (değişiklik en geç 30 sn içinde)."
                  : "Politika kapalı: bugünkü davranış. Açtığınız kural tüm ofis kullanıcılarına uygulanır."}
              </p>
            </div>
          </div>
          <div className="mt-5 max-w-2xl">
            <OfficePolicyForm initial={officePolicy} currentIp={currentIp} canEdit={isOwner} />
          </div>
          {isOwner ? (
            <details className="mt-5 max-w-2xl rounded-[var(--radius-card)] border border-line px-4 py-3 text-xs text-text-muted">
              <summary className="cursor-pointer font-semibold text-ink-900">Kendinizi kilitlerseniz</summary>
              <p className="mt-2">
                Sahip muafiyeti açıkken IP listesi sizi engellemez. Muafiyeti kapatıp listede olmayan bir ağda kaldıysanız EmlakSoft
                destek ekibine yazın: politika doğrulamalı bir işlemle sıfırlanır ve tüm kullanıcılar yeniden girebilir.
              </p>
            </details>
          ) : null}
        </section>
      ) : null}

      {officeSessions ? (
        <section id="oturumlar" className="dashboard-panel scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
          <div className="flex items-center gap-3 border-b border-line pb-4">
            <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
              <MonitorSmartphone className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display font-bold text-ink-950">Açık oturumlar ({officeSessions.rows.length})</h2>
              <p className="text-xs text-text-muted">Ofisinizdeki kullanıcıların açık oturumları; tanımadığınız oturumu kapatın.</p>
            </div>
          </div>
          {officeSessions.pending ? (
            <p className="mt-5 text-sm text-text-muted">Oturum listesi veritabanı güncellemesinden sonra görünür (kurulum bekliyor).</p>
          ) : officeSessions.rows.length === 0 ? (
            <p className="mt-5 text-sm text-text-muted">Açık oturum yok.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line rounded-[var(--radius-card)] border border-line">
              {officeSessions.rows.map((r) => {
                const current = r.sessionId === currentSessionId;
                return (
                  <li key={r.sessionId} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-semibold text-ink-950">{r.name}</span>
                      {r.role ? <span className="ml-2 text-xs text-text-muted">{roleLabel(r.role)}</span> : null}
                      {current ? <span className="ml-2 rounded-full bg-mint-500/15 px-2 py-0.5 text-xs font-bold text-mint-700">Bu oturum</span> : null}
                      <p className="text-xs text-text-muted" title={r.userAgent ?? undefined}>
                        {deviceLabel(r.userAgent)} · {r.ip ?? "IP yok"}
                        {r.createdAt ? ` · giriş ${formatDate(r.createdAt)}` : ""}
                        {r.lastSeenAt ? ` · son etkinlik ${formatDate(r.lastSeenAt)}` : ""}
                      </p>
                    </div>
                    {current ? null : <RevokeOfficeSessionButton sessionId={r.sessionId} label={r.name} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/* Son girişler */}
      <section className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
            <History className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink-950">Son girişler</h2>
            <p className="text-xs text-text-muted">Hesabınıza ait son 20 giriş denemesi.</p>
          </div>
        </div>

        {loginEvents.length === 0 ? (
          <p className="mt-5 text-sm text-text-muted">
            Henüz giriş kaydı yok. Kayıtlar bir sonraki girişinizden itibaren burada listelenir.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table className="w-full min-w-[560px] text-sm">
              <THead>
                <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
                  <TH className="py-2.5 pr-4">Tarih</TH>
                  <TH className="py-2.5 pr-4">IP adresi</TH>
                  <TH className="py-2.5 pr-4">Cihaz</TH>
                  <TH className="py-2.5">Sonuç</TH>
                </TR>
              </THead>
              <TBody>
                {loginEvents.map((e) => {
                  const badge = RESULT_BADGE[e.result] ?? { label: e.result, variant: "default" as BadgeVariant };
                  return (
                    <TR key={e.id} className="border-b border-line/60 last:border-0">
                      <TD className="py-2.5 pr-4 whitespace-nowrap text-ink-900">{formatDate(e.created_at)}</TD>
                      <TD className="py-2.5 pr-4 font-mono text-xs text-text-muted">{e.ip ?? "—"}</TD>
                      <TD className="py-2.5 pr-4 text-text-muted" title={e.user_agent ?? undefined}>
                        {deviceLabel(e.user_agent)}
                      </TD>
                      <TD className="py-2.5">
                        <Badge variant={badge.variant} size="sm">
                          {badge.label}
                        </Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
