import { PageHeader } from "@/components/ui/page-header";
import Link from "@/components/ui/smart-link";
import { Building2, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestClaims } from "@/lib/supabase/auth-cache";
import { headers } from "next/headers";
import { officePolicyIp } from "@/lib/office-security/policy";
import { loadOfficePolicyForm, loadOfficeSessions, policyIsActive } from "@/lib/office-security/read";
import { roleLabel } from "@/lib/role-labels";
import { OfficePolicyForm, RevokeOfficeSessionButton } from "./office-policy-form";
import { requireModulePage } from "@/lib/require-module-page";
import { formatDateTimeTr } from "@/lib/format";

export const metadata = { title: "Güvenlik" };

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

/**
 * Ofis güvenliği (yalnız OFİS kapsamı): güvenlik politikası (2FA zorunluluğu, IP, oturum süresi, yeni cihaz bildirimi) ve
 * ofis kullanıcılarının açık oturumları. Kişisel iki adımlı doğrulama ve giriş geçmişi Hesabım > Güvenlik'tedir.
 * DG7: politika sahip ve genel müdüre görünür (yalnız sahip düzenler); açık oturumlar yalnız sahibe.
 */
export default async function SecuritySettingsPage() {
  const ctx = await requireModulePage("settings");
  const supabase = await createClient();
  const tenantId = ctx.tenantId;
  const isOwner = ctx.role === "owner" && Boolean(tenantId);
  const showPolicy = Boolean(tenantId) && (ctx.role === "owner" || ctx.role === "gm");

  const [officePolicy, officeSessions, currentIp, claims] = await Promise.all([
    showPolicy && tenantId ? loadOfficePolicyForm(supabase, tenantId) : Promise.resolve(null),
    isOwner && tenantId ? loadOfficeSessions(createAdminClient(), tenantId) : Promise.resolve(null),
    showPolicy ? headers().then(officePolicyIp) : Promise.resolve(null),
    isOwner ? getRequestClaims() : Promise.resolve(null),
  ]);
  const currentSessionId = typeof claims?.session_id === "string" ? claims.session_id : null;


  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Ayarlar", href: "/app/ayarlar" }, { label: "Güvenlik" }]}
        title="Güvenlik"
        description="Ofisinizin güvenlik politikası ve ofis kullanıcılarının açık oturumları."
        className="mb-0"
      />

      <p className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-sm text-text-muted">
        <ShieldCheck className="h-4 w-4 text-mint-600" aria-hidden="true" />
        Kendi iki adımlı doğrulamanız ve giriş geçmişiniz:
        <Link href="/app/hesabim?sekme=guvenlik" className="font-semibold text-brand-600 hover:underline">
          Hesabım &gt; Güvenlik
        </Link>
      </p>

      {!showPolicy ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-8 text-center text-sm text-text-muted">
          Ofis güvenlik politikasını ofis sahibi ve genel müdür görür.
        </p>
      ) : null}

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

    </div>
  );
}
