"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { Link2 } from "lucide-react";
import { InlinePanel } from "@/components/ui/inline-panel";

/**
 * Müşteri portalı linki — sayfa içi panel (popup değil).
 * Satır ⋮ menüsündeki "Müşteri portalı linki" (customer-row-delete.tsx) seçili müşteriyi küçük bir store'a yazar ve paneli açar;
 * liste üstündeki tek `CustomerPortalPanel` seçili müşteri için link üretir.
 */
export const CUSTOMER_PORTAL_PANEL_ID = "musteri-portali-linki";

/** `waMsisdn`: sunucuda hesaplanan WhatsApp numarası (`toWhatsAppMsisdn`, customer-rows.tsx); yoksa null. */
export type PortalTarget = { id: string; name: string; waMsisdn: string | null };
type Target = PortalTarget;

let target: Target | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getTarget = () => target;
export function setPortalTarget(next: Target | null) {
  target = next;
  listeners.forEach((l) => l());
}

/** Panel gövdesi (link üretimi + sonuç paneli) ilk açılışta iner: liste sayfasının ilk yük JS'ine girmez. */
const PanelBody = dynamic(() => import("./customer-portal-panel-body").then((m) => m.PanelBody), {
  ssr: false,
  loading: () => <div className="p-4 text-sm text-text-muted md:p-6">Yükleniyor…</div>,
});

/** Liste üstüne bir kez konur; satır düğmesi seçili müşteriyle açar. */
export function CustomerPortalPanel() {
  const customer = useSyncExternalStore(subscribe, getTarget, () => null);
  return (
    <InlinePanel
      id={CUSTOMER_PORTAL_PANEL_ID}
      title="Müşteri portalı linki"
      description={
        customer
          ? `${customer.name} kendi taleplerini, randevularını ve eşleşen portföyleri bu linkten görür.`
          : undefined
      }
      icon={<Link2 />}
    >
      {customer ? <PanelBody key={customer.id} customer={customer} /> : null}
    </InlinePanel>
  );
}
