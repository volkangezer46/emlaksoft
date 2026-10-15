"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { requestPortalLinkRenewal } from "@/app/actions/portal-link-renew";
import type { PortalLinkKind } from "@/lib/portal-link-renew";

/** "Yeni bağlantı iste" düğmesi (PUB-7): tek dokunuş, sonuç yerinde gösterilir; tekrar basılamaz. */
export function PortalLinkRenewButton({ kind, token, officeName }: { kind: PortalLinkKind; token: string; officeName: string }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (state === "sent") {
    return (
      <p role="status" className="flex items-start gap-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/10 px-4 py-3 text-sm text-ink-950">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" aria-hidden="true" />
        <span>Talebiniz {officeName} ekibine iletildi. Danışmanınız yeni bağlantıyı size kısa süre içinde gönderecek.</span>
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await requestPortalLinkRenewal(kind, token);
            if (res.error) {
              setError(res.error);
              setState("error");
              return;
            }
            setState("sent");
          })
        }
        className="focus-ring press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-600/90 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
        {pending ? "Gönderiliyor…" : "Yeni bağlantı iste"}
      </button>
      {state === "error" && error ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
