"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, RotateCcw, X } from "lucide-react";
import { setMatchDismissed } from "@/app/actions/matching";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import { DISMISS_REASONS, type DismissReason } from "@/lib/match-state";

/**
 * "Uygun değil" (CRM-G4): tek dokunuşla gerekçe seçilir (fiyat / konum / kat / oda / diğer), çift listeden gizlenir ve
 * bu talebe yeniden önerilmez. Gizlenmiş çift "Gizlenenleri göster" ile listede görünürken "Geri al" çizilir.
 * Pencere yok: gerekçeler satır içinde açılır (mobilde ≥44 px dokunma hedefi).
 */
export function MatchDismissButton({
  demandId,
  propertyId,
  dismissed = false,
}: {
  demandId: string;
  propertyId: string;
  dismissed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const submit = (reason: DismissReason | null) =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("demand_id", demandId);
      fd.set("property_id", propertyId);
      if (reason) fd.set("reason", reason);
      else fd.set("undo", "1");
      const res = await setMatchDismissed(fd);
      if ("error" in res) {
        push(res.error, "err");
        return;
      }
      setOpen(false);
      push(reason ? "Öneri gizlendi; bu talebe yeniden önerilmeyecek" : "Öneri yeniden listede", "ok");
      router.refresh();
    });

  if (dismissed) {
    return (
      <Button variant="secondary" size="xs" icon={RotateCcw} loading={pending} onClick={() => submit(null)}>
        Geri al
      </Button>
    );
  }

  if (!open) {
    return (
      <Button variant="ghost" size="xs" icon={EyeOff} onClick={() => setOpen(true)} title="Bu portföy bu müşteriye uymuyor: gerekçeyle gizle">
        Uygun değil
      </Button>
    );
  }

  return (
    <div role="group" aria-label="Neden uygun değil?" className="flex w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface-raised p-2 lg:w-auto">
      <span className="w-full text-xs font-semibold text-text-muted sm:w-auto">Neden uygun değil?</span>
      {DISMISS_REASONS.map((r) => (
        <Button key={r.key} variant="secondary" size="xs" disabled={pending} onClick={() => submit(r.key)}>
          {r.label}
        </Button>
      ))}
      <Button variant="ghost" size="icon" icon={X} aria-label="Vazgeç" onClick={() => setOpen(false)} disabled={pending} />
    </div>
  );
}
