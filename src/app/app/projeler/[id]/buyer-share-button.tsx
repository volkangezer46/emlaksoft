"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { prepareProjectBuyerWhatsApp } from "@/app/actions/project-sales";

/** Uygun alıcıya proje bağlantısı (WhatsApp; İYS izni sunucuda denetlenir). Tarayıcı sekmeyi engellerse bağlantı gösterilir. */
export function BuyerShareButton({ projectId, customerId, unitLabels }: { projectId: string; customerId: string; unitLabels: string[] }) {
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [fallback, setFallback] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        icon={MessageCircle}
        onClick={() =>
          start(async () => {
            setFallback(null);
            const res = await prepareProjectBuyerWhatsApp({ projectId, customerId, unitLabels });
            if (res.error || !res.waHref) {
              push(res.error ?? "Paylaşım hazırlanamadı", "err");
              return;
            }
            const win = window.open(res.waHref, "_blank", "noopener,noreferrer");
            if (!win) setFallback(res.waHref);
            push(`${res.recipient ?? "Alıcı"} için WhatsApp açıldı`, "ok");
          })
        }
      >
        WhatsApp ile gönder
      </Button>
      {fallback ? (
        <a href={fallback} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-600 hover:underline">
          WhatsApp&apos;ı aç
        </a>
      ) : null}
    </span>
  );
}
