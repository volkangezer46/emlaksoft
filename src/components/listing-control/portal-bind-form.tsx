"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { createPortalListing } from "@/app/actions/portal-listings";
import { LISTING_CHANNEL_OPTIONS, PORTAL_MEMBERSHIP_HREF, isCurrentPortal } from "@/lib/portals/catalog";

/**
 * Portal ilanı bağlama formu (portföy detayı). Mevcut `createPortalListing` eylemini kullanır:
 * ilan numarası DEĞİŞİMİ için `supersedes_id` (eski ilan seçilir, zincire eklenir), kayıtsız ilan eşleştirme adayı için
 * `candidate_id`. Aynı ilan numarası başka portföye bağlıysa sunucu reddeder. Seçenekler katalogdan gelir (`portals/catalog.ts`);
 * ofisin üye olmadığı portal soluk (seçilemez) durur ve "Üye değilsiniz, ekle" bağlantısı gösterilir (`activePortals`).
 */

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface";

export type LiveListingOption = { id: string; portal: string; externalId: string | null };

export function PortalBindForm({
  propertyId,
  liveListings,
  candidateId,
  activePortals,
}: {
  propertyId: string;
  liveListings: LiveListingOption[];
  candidateId?: string | null;
  /** Ofisin etkin üye olduğu portallar (verilmezse hepsi seçilebilir). */
  activePortals?: readonly string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [supersedes, setSupersedes] = useState("");

  const replacing = supersedes !== "";
  const prev = liveListings.find((l) => l.id === supersedes);
  const isMember = (value: string) => !activePortals || !isCurrentPortal(value) || activePortals.includes(value);
  const options = LISTING_CHANNEL_OPTIONS.map((o) => ({ ...o, member: isMember(o.value) }));
  const hasNonMember = options.some((o) => !o.member);
  const defaultPortal = options.find((o) => o.member)?.value ?? "";

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      action={(fd) => {
        setError(null);
        setDone(false);
        fd.set("property_id", propertyId);
        if (candidateId) fd.set("candidate_id", candidateId);
        if (supersedes) {
          fd.set("supersedes_id", supersedes);
          if (prev) fd.set("portal_name", prev.portal);
        }
        start(async () => {
          const r = await createPortalListing(fd);
          if (r.error) setError(r.error);
          else {
            setDone(true);
            router.refresh();
          }
        });
      }}
    >
      {liveListings.length > 0 ? (
        <label className="text-sm font-medium text-text sm:col-span-2">
          İşlem
          <select value={supersedes} onChange={(e) => setSupersedes(e.target.value)} className={`${fieldClass} mt-1.5`}>
            <option value="">Yeni portal ilanı bağla</option>
            {liveListings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.portal} ilan numarası değişti{l.externalId ? ` (eski no ${l.externalId})` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!replacing ? (
        <label className="text-sm font-medium text-text">
          Portal *
          <select name="portal_name" required defaultValue={defaultPortal} className={`${fieldClass} mt-1.5`}>
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={!o.member}>
                {o.member ? o.label : `${o.label} (üye değilsiniz)`}
              </option>
            ))}
          </select>
          {hasNonMember ? (
            <Link href={PORTAL_MEMBERSHIP_HREF} className="mt-1 inline-block text-xs font-semibold text-accent-text hover:underline">
              Üye değilsiniz, ekle
            </Link>
          ) : null}
        </label>
      ) : null}
      <label className="text-sm font-medium text-text">
        {replacing ? "Yeni ilan numarası *" : "İlan numarası"}
        <input name="portal_listing_id" required={replacing} maxLength={200} className={`${fieldClass} mt-1.5`} placeholder="2345678" />
      </label>
      <label className="text-sm font-medium text-text sm:col-span-2">
        İlan bağlantısı
        <input name="portal_url" type="url" maxLength={2048} className={`${fieldClass} mt-1.5`} placeholder="https://…" />
      </label>
      {error ? <p role="alert" className="text-sm text-danger-600 sm:col-span-2">{error}</p> : null}
      {done ? <p role="status" className="text-sm text-mint-700 sm:col-span-2">Kaydedildi.</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit" icon={Link2} loading={pending}>{replacing ? "İlan numarasını değiştir" : "Portal ilanını bağla"}</Button>
      </div>
    </form>
  );
}
