import { FileSignature, Handshake } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import type { DealContractKind } from "@/lib/sale-contract/build";

/** Anlaşmadan / kabul edilen tekliften önceden doldurulmuş sözleşme bağlantısı (SP3). */
export function dealContractHref(input: { dealId?: string | null; offerId?: string | null; kind: DealContractKind }): string {
  const qs = new URLSearchParams();
  if (input.dealId) qs.set("anlasma", input.dealId);
  if (input.offerId) qs.set("teklif", input.offerId);
  qs.set("sablon", input.kind);
  return `/app/sozlesmeler/yeni?${qs.toString()}`;
}

/**
 * "Kapora sözleşmesi hazırla" + "Aracılık sözleşmesi hazırla" (SP3). Anlaşma ve teklif sayfaları aynı bileşeni kullanır;
 * tutar, alıcı, satıcı/malik, portföy adresi ve kapora şablona dolar, sözleşme anlaşmaya/teklife kesin bağla kaydedilir.
 */
export function DealContractCta({
  dealId,
  offerId,
  className,
}: {
  dealId?: string | null;
  offerId?: string | null;
  className?: string;
}) {
  if (!dealId && !offerId) return null;
  return (
    <div className={className ?? "grid gap-2"}>
      <ButtonLink href={dealContractHref({ dealId, offerId, kind: "kapora" })} size="sm" icon={FileSignature} className="min-h-11 w-full sm:min-h-0">
        Kapora sözleşmesi hazırla
      </ButtonLink>
      <ButtonLink href={dealContractHref({ dealId, offerId, kind: "aracilik" })} size="sm" variant="secondary" icon={Handshake} className="min-h-11 w-full sm:min-h-0">
        Aracılık sözleşmesi hazırla
      </ButtonLink>
    </div>
  );
}
