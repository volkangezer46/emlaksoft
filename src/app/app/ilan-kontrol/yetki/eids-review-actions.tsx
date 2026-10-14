"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/ui/form-controls";
import { useToast } from "@/components/app/toast-provider";
import { approveEidsMessage, dismissEidsMessage, type EidsActionResult } from "@/app/actions/eids-inbound";

export type ReviewOption = { id: string; label: string };

/**
 * Kontrol bekliyor satırı eylemleri: portföy seç (aday listesi ya da eşleşme yoksa portföy kodu) → onayla; ya da yok say.
 * Sunucu eylemi rol kapısını (owner/gm/branch_manager) kendisi uygular; yetkisiz rol için yalnız bilgi gösterilir.
 */
export function EidsReviewActions({ messageId, options, canReview }: { messageId: string; options: ReviewOption[]; canReview: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState(options[0]?.id ?? "");
  const [code, setCode] = useState("");

  if (!canReview) return <span className="text-xs text-text-muted">Ofis sahibi, genel müdür ya da şube müdürü onaylar.</span>;

  const run = (fn: () => Promise<EidsActionResult>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.info) push(r.info, "ok");
      router.refresh();
    });
  };

  const ref = options.length > 0 ? choice : code.trim();
  return (
    <div className="flex min-w-0 flex-col gap-2 md:w-72">
      {options.length > 0 ? (
        <FormSelect aria-label="Uygulanacak portföy" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </FormSelect>
      ) : (
        <FormInput aria-label="Portföy kodu" placeholder="Portföy kodu (ör. P-1024)" value={code} maxLength={64} onChange={(e) => setCode(e.target.value)} />
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" icon={Check} loading={pending} disabled={!ref} onClick={() => run(() => approveEidsMessage(messageId, ref))}>
          Onayla ve uygula
        </Button>
        <Button size="sm" variant="ghost" icon={X} disabled={pending} onClick={() => run(() => dismissEidsMessage(messageId))}>
          Yok say
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
