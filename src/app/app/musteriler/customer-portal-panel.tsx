"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { Link2 } from "lucide-react";
import { createCustomerPortalToken } from "@/app/actions/customer-portal";
import { ResultPanel, WA_CUSTOMER } from "@/components/app/portal-link-dialog";
import { Button } from "@/components/ui/button";
import { InlinePanel, useInlinePanel } from "@/components/ui/inline-panel";
import { toWhatsAppLink } from "@/lib/phone";

/**
 * Müşteri portalı linki — sayfa içi panel (popup değil).
 * Satır ⋮ menüsündeki "Müşteri portalı linki" (customer-row-delete.tsx) seçili müşteriyi küçük bir store'a yazar ve paneli açar;
 * liste üstündeki tek `CustomerPortalPanel` seçili müşteri için link üretir.
 */
export const CUSTOMER_PORTAL_PANEL_ID = "musteri-portali-linki";

type Target = { id: string; name: string; phone: string | null };

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

function PanelBody({ customer }: { customer: Target }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { close } = useInlinePanel(CUSTOMER_PORTAL_PANEL_ID);

  const generate = () => {
    setError(null);
    startTransition(async () => {
      const res = await createCustomerPortalToken(customer.id);
      if (res.error || !res.url) setError(res.error ?? "Link üretilemedi.");
      else setUrl(res.url);
    });
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      {url ? (
        <ResultPanel url={url} waHref={toWhatsAppLink(customer.phone, WA_CUSTOMER(customer.name, url))} onReset={close} />
      ) : (
        <div className="space-y-3">
          <p className="max-w-2xl text-sm leading-relaxed text-text-muted">
            Müşteri portalda önerilen portföyleri <strong className="text-ink-950">beğenir ya da eler</strong>; bu geri
            bildirim eşleştirme ekranındaki skoru besler (beğenilen +10 puan ve rozet alır, elenen listeden gizlenir).
          </p>
          <p className="text-xs text-text-faint">
            Aynı müşteri için geçerli bir link zaten varsa yenisi üretilmez — mevcut link döner.
          </p>
          {error ? (
            <p role="alert" className="text-sm font-semibold text-danger-500">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" onClick={generate} loading={pending}>
              Linki üret
            </Button>
            <Button type="button" variant="secondary" onClick={close}>
              Kapat
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

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
