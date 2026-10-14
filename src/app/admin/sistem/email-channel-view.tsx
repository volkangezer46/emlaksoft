import { Suspense } from "react";
import { SettingField } from "@/components/settings/setting-field";
import { Badge } from "@/components/ui/badge";
import { EMAIL_SETTING_KEYS, type EmailChannelStatus, type EmailValueSource } from "@/lib/email/provider";
import { summarizeSenderDns, testResendConnection } from "@/lib/email/test-send";
import { EMAIL_WEBHOOK_SECRET_KEY } from "@/lib/settings/registry/email";
import { getPlatformSettingViews } from "@/lib/settings/read";
import { EmailChannelTools } from "@/app/admin/ayarlar/eposta/email-channel-tools";

function sourceLabel(s: EmailValueSource): string {
  if (s === "env") return "Sunucu ortamından geliyor (öncelikli)";
  if (s === "panel") return "Panelden girildi";
  return "Tanımlı değil";
}

/** Gönderen alan adı SPF/DKIM rozeti: Resend alan adı ayrıntısından (5 sn sınırlı, akışla gelir; sayfayı bekletmez). */
async function SenderDnsBadge() {
  const s = summarizeSenderDns(await testResendConnection());
  const variant = s.state === "ok" ? "success" : s.state === "failed" || s.state === "missing" ? "danger" : s.state === "pending" ? "warning" : "neutral";
  const label = s.state === "ok" ? "DNS doğrulandı" : s.state === "failed" ? "DNS hatalı" : s.state === "missing" ? "Alan adı yok" : s.state === "pending" ? "DNS bekliyor" : "DNS okunamadı";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant={variant} dot>
        {label}
      </Badge>
      <span className="text-xs text-text-muted">{s.text}</span>
    </span>
  );
}

export async function EmailChannelView({ status, canEdit, staffEmail }: { status: EmailChannelStatus; canEdit: boolean; staffEmail: string }) {
  const views = await getPlatformSettingViews();
  const pick = (keys: string[]) =>
    keys.map((k) => views.find((v) => v.key === k)).filter((v): v is NonNullable<typeof v> => Boolean(v));
  const channelViews = pick([EMAIL_SETTING_KEYS.apiKey, EMAIL_SETTING_KEYS.from, EMAIL_SETTING_KEYS.replyTo]);
  const extraViews = pick([EMAIL_WEBHOOK_SECRET_KEY]);
  const keyConfigured = status.keySource !== "none";
  const webhookEnv = Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim());

  return (
    <div className="space-y-6">
      <section aria-labelledby="kanal-baslik" className="scroll-mt-24 space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div>
          <h2 id="kanal-baslik" className="text-base font-semibold text-ink-950">
            E-posta kanalı
          </h2>
          <p className="text-xs text-text-muted">Anahtar şifreli saklanır ve bir daha gösterilmez. Sunucu ortamında tanımlı değer her zaman önceliklidir.</p>
        </div>
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-text-muted">Durum:</dt>
            <dd className="m-0">
              <Badge variant={status.enabled ? "success" : "warning"} dot>
                {status.enabled ? "Açık" : "Kapalı"}
              </Badge>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-text-muted">Resend anahtarı:</dt>
            <dd className="m-0 font-semibold text-ink-950">{sourceLabel(status.keySource)}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-text-muted">Gönderen:</dt>
            <dd className="m-0 font-semibold text-ink-950">
              {status.from ?? "—"} <span className="font-normal text-text-muted">({sourceLabel(status.fromSource)})</span>
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-x-2">
            <dt className="text-text-muted">Gönderen alan adı (SPF/DKIM):</dt>
            <dd className="m-0">
              {keyConfigured ? (
                <Suspense fallback={<span className="text-xs text-text-faint">Denetleniyor…</span>}>
                  <SenderDnsBadge />
                </Suspense>
              ) : (
                <span className="text-xs text-text-muted">Anahtar girilince denetlenir.</span>
              )}
            </dd>
          </div>
        </dl>
        <EmailChannelTools canEdit={canEdit} staffEmail={staffEmail} keyConfigured={keyConfigured} />
        <div className="grid gap-3">
          {channelViews.map((v) => (
            <SettingField key={v.key} view={v} canEdit={canEdit} />
          ))}
        </div>
      </section>

      <section id="eposta-webhook" aria-labelledby="webhook-baslik" className="scroll-mt-24 space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div>
          <h2 id="webhook-baslik" className="text-base font-semibold text-ink-950">
            E-posta teslim olayları (webhook)
          </h2>
          <p className="text-xs text-text-muted">
            Resend &gt; Webhooks: uç <code className="rounded bg-canvas px-1">https://emlaksoft.com.tr/api/webhooks/resend</code>, olaylar
            email.sent, delivered, delivery_delayed, bounced, complained, opened, clicked, failed. İmza anahtarı (whsec_…) aşağıya girilir
            {webhookEnv ? " — şu an sunucu ortamındaki RESEND_WEBHOOK_SECRET kullanılıyor" : ""}. Anahtar yokken olaylar reddedilir ve günlükte durum
            &quot;Gönderildi&quot;de kalır.
          </p>
        </div>
        <div className="grid gap-3">
          {extraViews.map((v) => (
            <SettingField key={v.key} view={v} canEdit={canEdit} />
          ))}
        </div>
      </section>
    </div>
  );
}
