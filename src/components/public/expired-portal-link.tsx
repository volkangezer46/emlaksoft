import { Clock3 } from "lucide-react";
import { PublicLinkNotFound } from "@/components/public/public-link-not-found";
import { PublicContactActions } from "@/components/public/public-contact-actions";
import { resolvePublicContact } from "@/lib/public-contact";
import type { ExpiredPortalLink } from "@/lib/portal-link-renew";
import { PortalLinkRenewButton } from "./portal-link-renew-button";

/**
 * Süresi dolmuş portal bağlantısı ekranı (PUB-7): çıkmaz sokak yerine ofis adı, iletişim düğmeleri ve
 * "Yeni bağlantı iste" (danışmana görev + bildirim). Kişisel veri gösterilmez; yalnız ofis kimliği.
 */
export function ExpiredPortalLinkScreen({ link, token }: { link: ExpiredPortalLink; token: string }) {
  const label = link.kind === "customer" ? "Müşteri paneli" : "Malik paneli";
  return (
    <PublicLinkNotFound
      icon={Clock3}
      title={`${label} bağlantınızın süresi doldu`}
      description={`Güvenliğiniz için bağlantılar belirli bir süre sonra kapanır. ${link.officeName} danışmanınızdan tek dokunuşla yeni bağlantı isteyebilirsiniz.`}
    >
      <div className="space-y-3 text-left">
        <PortalLinkRenewButton kind={link.kind} token={token} officeName={link.officeName} />
        <PublicContactActions
          contact={resolvePublicContact({
            officePhone: link.officePhone,
            whatsappText: `Merhaba, ${label.toLowerCase()} bağlantımın süresi dolmuş. Yeni bağlantı rica ediyorum.`,
          })}
          tone="light"
        />
        {link.officeSlug ? (
          <a
            href={`/vitrin/${link.officeSlug}`}
            className="flex min-h-11 items-center justify-center text-sm font-semibold text-brand-600 underline-offset-2 hover:underline"
          >
            {link.officeName} portföylerine göz atın
          </a>
        ) : null}
      </div>
    </PublicLinkNotFound>
  );
}
