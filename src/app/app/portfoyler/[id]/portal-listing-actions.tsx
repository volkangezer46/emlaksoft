"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import type { PortalName } from "@/lib/integrations/portals";
import {
  unpublishPropertyFromPortal,
  updatePropertyOnPortal,
} from "@/app/actions/portal-publish";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Canlı portal ilanı için API aksiyonları — "Portalda güncelle" ve
 * "Portaldan kaldır". Yalnızca yayın adaptörü OLAN ve API anahtarı tanımlı
 * (portalKey dolu) + portal ilan kimliği (externalId) mevcut ilanlarda çizilir;
 * aksi hâlde manuel "Teyit et / Kapat" akışı yeterlidir.
 *
 * Server action'lar (`portal-publish.ts`) `portals:edit` yetkisini kendi
 * içinde doğrular; burada sadece sonucu gösterir ve listeyi tazeleriz.
 */
export function PortalListingActions({
  propertyId,
  listingId,
  portalKey,
  externalId,
  portalLabel,
}: {
  propertyId: string;
  listingId: string;
  portalKey: PortalName;
  externalId: string;
  portalLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function runUpdate() {
    setError(null);
    setOkMsg(null);
    start(async () => {
      const res = await updatePropertyOnPortal(propertyId, portalKey, externalId, listingId);
      if (res.ok) {
        setOkMsg("Portalda güncellendi");
        router.refresh();
      } else {
        setError(res.error ?? "Güncelleme başarısız.");
      }
    });
  }

  function runUnpublish() {
    setError(null);
    setOkMsg(null);
    start(async () => {
      const res = await unpublishPropertyFromPortal(listingId, portalKey, externalId);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error ?? "Kaldırma başarısız.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={runUpdate}
        disabled={pending}
        className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Portalda güncelle
      </button>
      <ConfirmDialog
        trigger={
          <button
            type="button"
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-danger-500/20 px-3 py-2 text-xs font-semibold text-danger-500 transition hover:bg-danger-500/8"
          >
            <Trash2 className="h-3.5 w-3.5" /> Portaldan kaldır
          </button>
        }
        title="İlanı portaldan kaldır"
        description={`${portalLabel} portalındaki ilan API ile kaldırılacak ve kayıt "yayından kalktı" olarak işaretlenecek. Bu işlem geri alınamaz.`}
        confirmLabel="Portaldan kaldır"
        onConfirm={runUnpublish}
      />
      {okMsg ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-mint-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> {okMsg}
        </span>
      ) : null}
      {error ? <span className="max-w-[220px] truncate text-[11px] text-danger-500">{error}</span> : null}
    </div>
  );
}
