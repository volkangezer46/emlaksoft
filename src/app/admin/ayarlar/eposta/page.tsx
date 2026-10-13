import { Mail } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { SettingField } from "@/components/settings/setting-field";
import { Alert } from "@/components/ui/alert";
import { requirePlatformModule } from "@/lib/platform";
import { EMAIL_SETTING_KEYS, emailChannelStatus, type EmailValueSource } from "@/lib/email/provider";
import { EMAIL_TEMPLATES, templateSettingKey } from "@/lib/email/templates";
import { getPlatformSettingViews } from "@/lib/settings/read";
import { EmailChannelTools, TemplateSampleButton } from "./email-channel-tools";

export const metadata = { title: "E-posta şablonları" };

function sourceLabel(s: EmailValueSource): string {
  if (s === "env") return "Sunucu ortamından geliyor (öncelikli)";
  if (s === "panel") return "Panelden girildi";
  return "Tanımlı değil";
}

/**
 * E-posta kanalı (Resend: anahtar, gönderen, bağlantı testi, kendine test) + işlemsel şablonlar (ayar defteri; her
 * değişiklik gerekçeli geçmişe yazılır). Çözüm sırası: sunucu ortamı > panel > kapalı. Kapalıyken hiçbir e-posta
 * gönderilmez (uygulama içi bildirim sürer).
 */
export default async function EmailTemplatesPage() {
  const staff = await requirePlatformModule("sistem");
  const canEdit = staff.role === "super_admin";
  const [status, views] = await Promise.all([emailChannelStatus(), getPlatformSettingViews()]);
  const channelViews = [EMAIL_SETTING_KEYS.apiKey, EMAIL_SETTING_KEYS.from, EMAIL_SETTING_KEYS.replyTo]
    .map((k) => views.find((v) => v.key === k))
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const keyConfigured = status.keySource !== "none";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Ayarlar"
        icon={Mail}
        title="E-posta şablonları"
        description="E-posta kanalı ve işlemsel e-postaların konu ve metinleri. Sağlayıcı: Resend (tek adaptör, src/lib/email/provider.ts)."
      />
      {status.enabled ? (
        <Alert tone="success" title="E-posta kanalı açık">
          Gönderen: {status.from}. Şablonlardaki değişiklik bir sonraki gönderimde kullanılır.
        </Alert>
      ) : (
        <Alert tone="warning" title="E-posta kanalı kapalı">
          {status.reason}. Kanal kapalıyken e-posta gönderilmez; deneme hatırlatması ve diğer bildirimler uygulama içi bildirim olarak devam eder.
          Açmak için aşağıdaki &quot;E-posta kanalı&quot; kartından Resend anahtarı ve doğrulanmış alan adından gönderen adresi girin.
        </Alert>
      )}

      <section id="kanal" aria-labelledby="kanal-baslik" className="scroll-mt-24 space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <div>
          <h2 id="kanal-baslik" className="text-base font-semibold text-ink-950">
            E-posta kanalı
          </h2>
          <p className="text-xs text-text-muted">Anahtar şifreli saklanır ve bir daha gösterilmez. Sunucu ortamında tanımlı değer her zaman önceliklidir.</p>
        </div>
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
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
        </dl>
        <EmailChannelTools canEdit={canEdit} staffEmail={staff.email} keyConfigured={keyConfigured} />
        <div className="grid gap-3">
          {channelViews.map((v) => (
            <SettingField key={v.key} view={v} canEdit={canEdit} />
          ))}
        </div>
      </section>

      {EMAIL_TEMPLATES.map((t) => (
        <div key={t.key} className="space-y-2">
          <RegistrySettings
            id={t.key}
            title={t.label}
            description={`Gönderen akış: ${t.usedBy}`}
            keys={[templateSettingKey(t.key, "subject"), templateSettingKey(t.key, "body")]}
            canEdit={canEdit}
          />
          {canEdit ? <TemplateSampleButton templateKey={t.key} disabled={!status.enabled} /> : null}
        </div>
      ))}
    </div>
  );
}
