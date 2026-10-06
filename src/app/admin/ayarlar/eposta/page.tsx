import { Mail } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { Alert } from "@/components/ui/alert";
import { requirePlatformModule } from "@/lib/platform";
import { emailChannelStatus } from "@/lib/email/provider";
import { EMAIL_TEMPLATES, templateSettingKey } from "@/lib/email/templates";

export const metadata = { title: "E-posta şablonları" };

/**
 * E-posta kanalı durumu + işlemsel şablonlar (ayar defteri; her değişiklik gerekçeli geçmişe yazılır).
 * Kanal yalnız RESEND_API_KEY + EMAIL_FROM tanımlıysa açıktır; kapalıyken hiçbir e-posta gönderilmez (uygulama içi bildirim sürer).
 */
export default async function EmailTemplatesPage() {
  const staff = await requirePlatformModule("sistem");
  const status = emailChannelStatus();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Ayarlar"
        icon={Mail}
        title="E-posta şablonları"
        description="İşlemsel e-postaların konu ve metinleri. Sağlayıcı: Resend (tek adaptör, src/lib/email/provider.ts)."
      />
      {status.enabled ? (
        <Alert tone="success" title="E-posta kanalı açık">
          Gönderen: {status.from}. Şablonlardaki değişiklik bir sonraki gönderimde kullanılır.
        </Alert>
      ) : (
        <Alert tone="warning" title="E-posta kanalı kapalı">
          {status.reason}. Kanal kapalıyken e-posta gönderilmez; deneme hatırlatması ve diğer bildirimler uygulama içi bildirim olarak devam eder.
          Açmak için üretim ortamına RESEND_API_KEY ve doğrulanmış alan adından EMAIL_FROM tanımlanmalıdır (platform sahibi işi).
        </Alert>
      )}
      {EMAIL_TEMPLATES.map((t) => (
        <RegistrySettings
          key={t.key}
          id={t.key}
          title={t.label}
          description={`Gönderen akış: ${t.usedBy}`}
          keys={[templateSettingKey(t.key, "subject"), templateSettingKey(t.key, "body")]}
          canEdit={staff.role === "super_admin"}
        />
      ))}
    </div>
  );
}
