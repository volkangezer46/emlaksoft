import Link from "next/link";
import { ArrowLeft, History, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { isNetgsmConfigured } from "@/lib/messaging/netgsm";
import { getTenantNetgsmConfig } from "@/app/imza/_lib/sms";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { TwoFactorForm } from "./two-factor-form";

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
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}

export default async function SecuritySettingsPage() {
  const ctx = await requireModulePage("settings");
  const supabase = await createClient();

  const [{ data: profile }, { data: events }, tenantCfg, platformConfigured] = await Promise.all([
    supabase.from("profiles").select("two_factor_sms, phone").eq("id", ctx.userId).maybeSingle(),
    supabase
      .from("login_events")
      .select("id, ip, user_agent, result, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(20),
    ctx.tenantId ? getTenantNetgsmConfig(ctx.tenantId) : Promise.resolve(null),
    isNetgsmConfigured(),
  ]);

  // Kimlik bilgisi client'a gitmez — yalnız var/yok bilgisi kullanılır
  const smsConfigured = tenantCfg !== null || platformConfigured;
  const loginEvents = events ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/app/ayarlar"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-brand-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Ayarlar
        </Link>
        <h1 className="mt-2 font-display text-2xl font-extrabold text-ink-950">Güvenlik</h1>
        <p className="mt-1 text-sm text-text-muted">
          Hesabınız için iki adımlı doğrulama ve giriş geçmişi.
        </p>
      </div>

      {/* 2FA */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-mint-500/12 text-mint-600">
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

      {/* Son girişler */}
      <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-4 md:p-6">
        <div className="flex items-center gap-3 border-b border-line pb-4">
          <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-brand-600/10 text-brand-600">
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
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                  <th className="py-2.5 pr-4">Tarih</th>
                  <th className="py-2.5 pr-4">IP adresi</th>
                  <th className="py-2.5 pr-4">Cihaz</th>
                  <th className="py-2.5">Sonuç</th>
                </tr>
              </thead>
              <tbody>
                {loginEvents.map((e) => {
                  const badge = RESULT_BADGE[e.result] ?? { label: e.result, variant: "default" as BadgeVariant };
                  return (
                    <tr key={e.id} className="border-b border-line/60 last:border-0">
                      <td className="py-2.5 pr-4 whitespace-nowrap text-ink-900">{formatDate(e.created_at)}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-text-muted">{e.ip ?? "—"}</td>
                      <td className="py-2.5 pr-4 text-text-muted" title={e.user_agent ?? undefined}>
                        {deviceLabel(e.user_agent)}
                      </td>
                      <td className="py-2.5">
                        <Badge variant={badge.variant} size="sm">
                          {badge.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
