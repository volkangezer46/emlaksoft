import Link from "@/components/ui/smart-link";
import { Share2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { eligibleListingLinks, SOCIAL_LINK_REQUIRED_MESSAGE } from "@/lib/social-card/core";
import { loadSocialCardData } from "@/lib/social-card/load";
import { SocialCardPicker } from "./social-card-picker";

/**
 * Portföy "Medya" sekmesi: sosyal medya paylaşım kartı (1080×1080 gönderi, 1080×1920 hikâye).
 * EİDS doğrulamalı ilan bağlantısı (yayındaki portal ilanı) yoksa kart ÜRETİLMEZ; neden ve çözüm yolu gösterilir.
 */
export async function SocialCardPanel({ propertyId, tenantId }: { propertyId: string; tenantId: string }) {
  const db = await createClient();
  const data = await loadSocialCardData(db, tenantId, propertyId);
  if (!data) return null;
  const links = eligibleListingLinks(data.listings).map((l) => ({ id: l.id, label: `${l.portalName ?? "Portal"} · ${l.portalUrl}` }));

  return (
    <section aria-labelledby="sosyal-kart-baslik" className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <h2 id="sosyal-kart-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
        <Share2 className="h-4 w-4 text-brand-600" aria-hidden /> Sosyal medya paylaşım kartı
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        Sosyal medyada ilan paylaşırken her gönderide EİDS&apos;te doğrulanmış ilanın bağlantısı bulunmalıdır. Kart ve paylaşım metni
        bağlantıyı, yetki belgesi no ve EİDS taşınmaz no&apos;yu (girilmişse) otomatik ekler.
      </p>
      {links.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-amber-400/50 bg-amber-400/[0.06] px-4 py-3 text-sm text-text-muted">
          {SOCIAL_LINK_REQUIRED_MESSAGE}{" "}
          <Link href={`/app/portfoyler/${propertyId}?sekme=portallar`} className="font-semibold text-brand-600 hover:underline">
            Yayın &amp; portallar
          </Link>
        </p>
      ) : (
        <SocialCardPicker propertyId={propertyId} links={links} hasEidsNo={Boolean(data.eidsNo)} hasLicenseNo={Boolean(data.office.licenseNo)} />
      )}
    </section>
  );
}
