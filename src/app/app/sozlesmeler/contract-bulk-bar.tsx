"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Download } from "lucide-react";
import { BulkBar } from "@/components/ui/list-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import { bulkCancelContracts } from "@/app/actions/contracts";
import { exportContractsCsv } from "@/app/actions/export";
import { downloadCsv } from "@/lib/download-csv";

/** Sözleşme listesi toplu işlemleri: iptal (onaylı; imzalı/reddedilmiş atlanır) ve seçili CSV. */
export function ContractBulkBar() {
  const { selected, clear } = useBulkSelection();
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  if (selected.size === 0) return null;
  const ids = [...selected];

  return (
    <BulkBar count={selected.size} noun="sözleşme" onClear={clear}>
      <ConfirmDialog
        title={`${ids.length} sözleşme iptal edilsin mi?`}
        description="İmza bağlantıları geçersizleşir. İmzalanmış veya reddedilmiş sözleşmeler atlanır; kayıtlar silinmez."
        confirmLabel="İptal et"
        onConfirm={async () => {
          const res = await bulkCancelContracts(ids);
          if (res.error) return push(res.error, "err");
          const failed = res.failed ?? 0;
          push(`${res.cancelled ?? 0} sözleşme iptal edildi${failed > 0 ? ` · ${failed} atlandı${res.firstError ? ` (${res.firstError})` : ""}` : ""}`, failed > 0 ? "err" : "ok");
          clear();
          router.refresh();
        }}
        trigger={
          <Button size="sm" variant="danger" loading={pending}>
            <Ban className="h-3.5 w-3.5" /> İptal et
          </Button>
        }
      />
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await exportContractsCsv(ids);
            if (res.error || !res.csv) return push(res.error ?? "İndirilecek kayıt yok", "err");
            downloadCsv(res.csv, res.filename ?? "sozlesmeler.csv");
            push(`${res.rowCount ?? 0} sözleşme CSV olarak indirildi`, "ok");
          })
        }
      >
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>
    </BulkBar>
  );
}
