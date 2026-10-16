"use client";

import { useState, useTransition } from "react";
import { createCustomerPortalToken } from "@/app/actions/customer-portal";
import { ResultPanel, WA_CUSTOMER } from "@/components/app/portal-link-dialog";
import { Button } from "@/components/ui/button";
import { useInlinePanel } from "@/components/ui/inline-panel";
import { CUSTOMER_PORTAL_PANEL_ID, type PortalTarget as Target } from "./customer-portal-panel";

/** `toWhatsAppLink(phone, mesaj)` ile birebir aynı bağlantı; numara sunucudan geldiği için telefon kuralları istemciye inmez. */
function waLink(msisdn: string | null, message: string): string | null {
  return msisdn ? `https://wa.me/${msisdn}?text=${encodeURIComponent(message)}` : null;
}

/** Müşteri portalı paneli gövdesi (tembel; `customer-portal-panel.tsx` ilk açılışta bağlar). */
export function PanelBody({ customer }: { customer: Target }) {
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
        <ResultPanel url={url} waHref={waLink(customer.waMsisdn, WA_CUSTOMER(customer.name, url))} onReset={close} />
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
