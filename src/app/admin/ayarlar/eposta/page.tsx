import { Ban, FileText, Mail, PlugZap, ScrollText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageTabs } from "@/components/app/page-tabs";
import { Alert } from "@/components/ui/alert";
import { requirePlatformModule } from "@/lib/platform";
import { emailChannelStatus } from "@/lib/email/provider";
import { ChannelView } from "./channel-view";
import { LogView } from "./log-view";
import { SuppressionView } from "./suppression-view";
import { TemplatesView } from "./templates-view";

export const metadata = { title: "E-posta" };

const TABS = [
  { id: "kanal", label: "Kanal", icon: PlugZap },
  { id: "sablonlar", label: "Şablonlar", icon: FileText },
  { id: "gunluk", label: "Günlük", icon: ScrollText },
  { id: "bastirma", label: "Bastırma", icon: Ban },
] as const;
type TabId = (typeof TABS)[number]["id"];

export type EmailPageSearch = { sekme?: string; durum?: string; sablon?: string; ofis?: string; sayfa?: string };

/**
 * Ayarlar > E-posta (AD7): kanal durumu + gönderen alan adı DNS rozeti, şablon merkezi (değişken kataloğu, HTML
 * önizleme, kendine örnek gönderim), gönderim günlüğü (Resend webhook durumlarıyla) ve bastırma listesi. Tek kapı:
 * `sistem` modülü; düzenleme/test/bastırma yalnız süper admin. Çözüm sırası: sunucu ortamı > panel > kapalı; kanal
 * kapalıyken hiçbir e-posta gönderilmez ve günlüğe "kanal kapalı" düşer.
 */
export default async function EmailSettingsPage({ searchParams }: { searchParams?: Promise<EmailPageSearch> }) {
  const staff = await requirePlatformModule("sistem");
  const canEdit = staff.role === "super_admin";
  const sp = (await searchParams) ?? {};
  const active: TabId = TABS.some((t) => t.id === sp.sekme) ? (sp.sekme as TabId) : "kanal";
  const status = await emailChannelStatus();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Ayarlar"
        icon={Mail}
        title="E-posta"
        description="Kanal ve gönderen alan adı, işlemsel ve giriş e-postası şablonları, gönderim günlüğü ve bastırma listesi. Sağlayıcı: Resend."
      />
      <PageTabs base="/admin/ayarlar/eposta" label="E-posta sekmeleri" tabs={TABS} active={active} />
      {status.enabled ? (
        <Alert tone="success" title="E-posta kanalı açık">
          Gönderen: {status.from}. Şablonlardaki değişiklik bir sonraki gönderimde kullanılır.
        </Alert>
      ) : (
        <Alert tone="warning" title="E-posta kanalı kapalı">
          {status.reason}. Kanal kapalıyken e-posta gönderilmez (günlüğe &quot;kanal kapalı&quot; düşer); bildirimler uygulama içinde sürer.
          Açmak için &quot;Kanal&quot; sekmesinden Resend anahtarı ve doğrulanmış alan adından gönderen adresi girin.
        </Alert>
      )}
      {active === "sablonlar" ? (
        <TemplatesView canEdit={canEdit} channelEnabled={status.enabled} />
      ) : active === "gunluk" ? (
        <LogView sp={sp} />
      ) : active === "bastirma" ? (
        <SuppressionView sp={sp} canEdit={canEdit} />
      ) : (
        <ChannelView status={status} canEdit={canEdit} staffEmail={staff.email} />
      )}
    </div>
  );
}
