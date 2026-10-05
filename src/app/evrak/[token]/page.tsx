import type { Metadata } from "next";
import { Ban, Clock, FileUp, Link2Off, PackageCheck } from "lucide-react";
import { PortalInvalidLink } from "@/components/public/portal-kit";
import { PublicStateBox, PublicTokenPage } from "@/components/public/token-page";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOC_TYPE_LABELS, KVKK_PLATFORM_NOTICE_HREF, KVKK_PLATFORM_NOTICE_TEXT, isDocType } from "@/lib/doc-request/doc-request";
import { lookupPublicRequest } from "@/lib/doc-request/server";
import { UploadPanel } from "./upload-panel";

// Evrak linkleri kişiye özeldir: arama motorlarına kapalı, önbelleğe alınmaz.
export const metadata: Metadata = {
  title: "Evrak yükleme",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

const STATE_COPY = {
  expired: { icon: Clock, title: "Bağlantının süresi doldu", description: "Lütfen ofisinizden yeni bir evrak bağlantısı isteyin." },
  revoked: { icon: Ban, title: "Bağlantı iptal edildi", description: "Bu bağlantı ofis tarafından iptal edildi. Gerekirse ofisinizle iletişime geçin." },
  completed: { icon: PackageCheck, title: "Evraklar zaten gönderildi", description: "Bu bağlantı tek kullanımlıktır ve kapandı. Teşekkür ederiz." },
  full: { icon: PackageCheck, title: "Dosya sınırına ulaşıldı", description: "Bu bağlantı için yüklenebilecek en çok dosya sayısına ulaşıldı. Ofisiniz inceleyecek." },
} as const;

/**
 * Evrak yükleme PUBLIC sayfası. Token SHA-256 özetiyle çözülür; biçim dışı, bilinmeyen, örnek veri,
 * pasif ofis ve kapalı modül aynı "geçersiz" ekranına iner. Müşteri adı ve portföy bilgisi
 * GÖSTERİLMEZ (link yanlış ele geçerse kişisel veri sızmasın).
 */
export default async function EvrakPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invalid = (
    <PortalInvalidLink
      icon={Link2Off}
      description="Bu evrak bağlantısı geçersiz veya kapalı. Ofisinizden yeni bir bağlantı isteyin."
    />
  );

  const ip = await clientIp();
  const view = await checkRateLimit(`doc-request:view:ip:${ip}`, { limit: 120, windowSec: 10 * 60, failurePolicy: "deny" });
  if (!view.allowed) return invalid;

  const lookup = await lookupPublicRequest(token);
  if (!lookup.ok) return invalid;
  const { request } = lookup;

  const common = {
    office: lookup.tenantName,
    logoUrl: lookup.logoUrl,
    brandColor: lookup.brandColor,
    icon: FileUp,
    title: request.title,
    purpose: "Bu sayfa yalnızca evrak yüklemek içindir",
  };

  if (lookup.state !== "ok") {
    const c = STATE_COPY[lookup.state];
    return (
      <PublicTokenPage {...common} subtitle="Evrak yükleme bağlantısı">
        <PublicStateBox icon={c.icon} title={c.title} description={c.description} tone="warning" />
      </PublicTokenPage>
    );
  }

  const admin = createAdminClient();
  const { data: files } = await admin
    .from("document_request_files")
    .select("doc_type")
    .eq("request_id", request.id)
    .eq("tenant_id", request.tenant_id)
    .eq("status", "verified");
  const uploaded = new Map<string, number>();
  for (const f of files ?? []) uploaded.set(f.doc_type, (uploaded.get(f.doc_type) ?? 0) + 1);

  const types = request.requested_types.filter(isDocType).map((t) => ({
    type: t,
    label: DOC_TYPE_LABELS[t],
    uploaded: uploaded.get(t) ?? 0,
  }));

  return (
    <PublicTokenPage
      {...common}
      subtitle="Aşağıdaki evrakları telefonunuzdan fotoğraf çekerek veya dosya seçerek yükleyin."
    >
      <UploadPanel token={token} types={types} kvkkText={KVKK_PLATFORM_NOTICE_TEXT} kvkkHref={KVKK_PLATFORM_NOTICE_HREF} canUpload />
    </PublicTokenPage>
  );
}
