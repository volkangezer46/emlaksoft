import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Ban, Building2, Clock, KeyRound, MapPin, Wallet } from "lucide-react";
import { PublicDetailList, PublicStateBox, PublicTokenPage } from "@/components/public/token-page";
import { PublicModuleClosed } from "@/components/modules/public-module-closed";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { resolvePublicContact } from "@/lib/public-contact";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { now, trDayKey } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { APPLICATION_DOC_HINTS, APPLICATION_DOC_LABELS, APPLICATION_DOC_TYPES } from "@/lib/rentals/applications";
import { resolveApplicationLink } from "@/lib/rentals/application-link.server";
import { KVKK_PLATFORM_NOTICE_HREF } from "@/lib/doc-request/doc-request";
import { ApplicationForm } from "./application-form";

// Başvuru bağlantısı ilanla paylaşılır ama kişisel veri toplar: arama motorlarına kapalı, önbelleğe alınmaz.
export const metadata: Metadata = {
  title: "Kiracı başvurusu",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

/**
 * Kiracı adayı PUBLIC başvuru formu (SP5). Token portföye sabit; biçim dışı/bilinmeyen/örnek veri/pasif ofis = 404.
 * Açık adres GÖSTERİLMEZ (yalnız ilçe/il). Mülk yönetimi modülü kapalıysa "kullanılamıyor" sayfası.
 * Form → KVKK onayı → kayıt; ardından aynı sayfada evrak yükleme adımı (2 saatlik başvuruya bağlı anahtar).
 */
export default async function KiraciBasvuruPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = await clientIp();
  const view = await checkRateLimit(`rental-app:view:ip:${ip}`, { limit: 120, windowSec: 10 * 60, failurePolicy: "deny" });
  if (!view.allowed) notFound();

  const lookup = await resolveApplicationLink(token);
  if (!lookup.ok) {
    if (lookup.reason === "module_closed") return <PublicModuleClosed officeName={lookup.officeName} />;
    notFound();
  }
  const { property, tenant, link } = lookup;
  const propLabel = property.title ?? property.code ?? "Kiralık daire";
  const location = [property.district, property.province].filter(Boolean).join(", ");
  const rent = link.asking_rent ?? property.listPrice;
  const contact = resolvePublicContact({
    advisorPhone: null,
    officePhone: tenant.phone,
    whatsappText: `Merhaba, "${propLabel}" kiralık ilanı için başvuru hakkında bilgi almak istiyorum.`,
  });

  const common = {
    office: tenant.name,
    logoUrl: tenant.logoUrl,
    brandColor: tenant.brandColor,
    icon: KeyRound,
    title: "Kiracı başvurusu",
    purpose: "Bu sayfa yalnızca kiracı başvurusu içindir",
  };

  if (lookup.state !== "open") {
    return (
      <PublicTokenPage {...common} subtitle={propLabel}>
        <PublicStateBox
          icon={lookup.state === "expired" ? Clock : Ban}
          tone="warning"
          title={lookup.state === "expired" ? "Başvuru süresi doldu" : "Bu ilana başvuru kapandı"}
          description="Ev sahibi kiracısını seçmiş olabilir. Benzer ilanlar için ofisle iletişime geçebilirsiniz."
        />
        <PublicContactActions contact={contact} tone="light" className="mt-4" />
      </PublicTokenPage>
    );
  }

  const docs = APPLICATION_DOC_TYPES.map((t) => ({ type: t, label: APPLICATION_DOC_LABELS[t], hint: APPLICATION_DOC_HINTS[t] ?? null }));

  return (
    <PublicTokenPage
      {...common}
      width="xl"
      subtitle="Bilgilerinizi bırakın, ev sahibine sunulacak dosyanız hazırlansın. Yaklaşık 3 dakika sürer."
    >
      <PublicDetailList
        items={[
          { label: "Portföy", value: propLabel, icon: Building2 },
          ...(location ? [{ label: "Konum", value: location, icon: MapPin }] : []),
          ...(rent ? [{ label: "Aylık kira", value: formatTry(rent), icon: Wallet }] : []),
        ]}
      />
      <ApplicationForm
        token={token}
        today={trDayKey(now())}
        monthlyRent={rent ?? null}
        docs={docs}
        kvkkHref={KVKK_PLATFORM_NOTICE_HREF}
        officeName={tenant.name}
      />
      <PublicContactActions contact={contact} tone="light" className="mt-5" />
    </PublicTokenPage>
  );
}
