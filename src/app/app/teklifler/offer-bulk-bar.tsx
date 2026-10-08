"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2, X } from "lucide-react";
import { BulkBar } from "@/components/ui/list-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import { bulkUpdateOfferStatus } from "@/app/actions/offers";

/** Teklif listesi toplu işlemleri: reddet / geri çek (onaylı, tek tek atomik geçiş). */
export function OfferBulkBar() {
  const { selected, clear } = useBulkSelection();
  const router = useRouter();
  const { push } = useToast();
  const [pending] = useTransition();
  if (selected.size === 0) return null;
  const ids = [...selected];

  async function close(status: "rejected" | "withdrawn", verb: string) {
    const res = await bulkUpdateOfferStatus(ids, status);
    if (res.error) return push(res.error, "err");
    const failed = res.failed ?? 0;
    push(`${res.updated ?? 0} teklif ${verb}${failed > 0 ? ` · ${failed} atlandı${res.firstError ? ` (${res.firstError})` : ""}` : ""}`, failed > 0 ? "err" : "ok");
    clear();
    router.refresh();
  }

  return (
    <BulkBar count={selected.size} noun="teklif" onClear={clear}>
      <ConfirmDialog
        title={`${ids.length} teklif reddedilsin mi?`}
        description="Kapanmış teklifler yeniden açılamaz. Zaten kapanmış olanlar atlanır."
        confirmLabel="Reddet"
        onConfirm={() => close("rejected", "reddedildi")}
        trigger={
          <Button size="sm" variant="secondary" loading={pending}>
            <X className="h-3.5 w-3.5" /> Reddet
          </Button>
        }
      />
      <ConfirmDialog
        title={`${ids.length} teklif geri çekilsin mi?`}
        description="Kapanmış teklifler yeniden açılamaz. Zaten kapanmış olanlar atlanır."
        confirmLabel="Geri çek"
        onConfirm={() => close("withdrawn", "geri çekildi")}
        trigger={
          <Button size="sm" variant="secondary" loading={pending}>
            <Undo2 className="h-3.5 w-3.5" /> Geri çek
          </Button>
        }
      />
    </BulkBar>
  );
}
