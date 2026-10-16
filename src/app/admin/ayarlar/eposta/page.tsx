import Link from "@/components/ui/smart-link";
import { Ban, FileText, Mail, ScrollText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import { RegistrySettings } from "@/components/settings/registry-settings";
import { requirePlatformModule } from "@/lib/platform";
import { emailChannelStatus } from "@/lib/email/provider";
import { EMAIL_FOOTER_KEY } from "@/lib/settings/registry/email";
import { LogView } from "./log-view";
import { SuppressionView } from "./suppression-view";
import { TemplatesView } from "./templates-view";

export const metadata = { title: "E-posta şablonları" };

const BASE = "/admin/ayarlar/eposta";
const TABS = [
  { id: "sablonlar", label: "Şablonlar", icon: FileText },
  { id: "gunluk", label: "Gönderim günlüğü", icon: ScrollText },
  { id: "bastirma", label: "Engel listesi", icon: Ban },
] as const;
type TabId = (typeof TABS)[number]["id"];

export type EmailPageSearch = { sekme?: string; durum?: string; sablon?: string; ofis?: string; sayfa?: string };

/**
 * Ayarlar > E-posta şablonları (AD7): şablon merkezi (değişken kataloğu, HTML önizleme, kendine örnek gönderim), ortak alt
 * bilgi, gönderim günlüğü (Resend webhook durumlarıyla) ve engel (bastırma) listesi. Kanal (Resend anahtarı, gönderen, alan
 * adı SPF/DKIM, webhook) Sistem > Entegrasyonlar'dadır; burada yalnız tek satır durum + bağlantı. Tek kapı: `sistem`
 * modülü; düzenleme/test/bastırma yalnız süper admin.
 */
export default async function EmailSettingsPage({ searchParams }: { searchParams?: Promise<EmailPageSearch> }) {
  const staff = await requirePlatformModule("sistem");
  const canEdit = staff.role === "super_admin";
  const sp = (await searchParams) ?? {};
  const active: TabId = TABS.some((t) => t.id === sp.sekme) ? (sp.sekme as TabId) : "sablonlar";
  const status = await emailChannelStatus();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="mail"
        eyebrow="Ayarlar"
        icon={Mail}
        title="E-posta şablonları"
        description="İşlemsel ve giriş e-postası şablonları, ortak alt bilgi, gönderim günlüğü ve engel listesi."
      />
      <p className="text-sm text-text-muted" role="status">
        E-posta kanalı{" "}
        <strong className={status.enabled ? "text-mint-700" : "text-amber-700"}>{status.enabled ? `açık (gönderen: ${status.from})` : "kapalı"}</strong>
        {status.enabled ? null : <> ({status.reason}; kapalıyken e-posta gönderilmez, bildirimler uygulama içinde sürer)</>}
        {" · "}
        <Link href="/admin/sistem?sekme=entegrasyonlar#anahtar-eposta" className="font-semibold text-brand-600 hover:underline">
          Kanal, anahtar ve alan adı: Entegrasyonlar →
        </Link>
      </p>
      <SegmentTabs
        items={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, href: t.id === "sablonlar" ? BASE : `${BASE}?sekme=${t.id}` }))}
        active={active}
        label="E-posta sekmeleri"
      />
      {active === "gunluk" ? (
        <LogView sp={sp} />
      ) : active === "bastirma" ? (
        <SuppressionView sp={sp} canEdit={canEdit} />
      ) : (
        <>
          <TemplatesView canEdit={canEdit} channelEnabled={status.enabled} />
          <RegistrySettings id="alt-bilgi" title="Ortak alt bilgi" description="Tüm işlemsel ve giriş e-postalarının alt satırı." keys={[EMAIL_FOOTER_KEY]} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}
