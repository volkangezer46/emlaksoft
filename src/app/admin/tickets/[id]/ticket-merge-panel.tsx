"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Combobox } from "@/components/ui/combobox";
import { mergeSupportTickets } from "@/app/actions/ticket-merge";

export type MergeCandidate = { id: string; label: string; hint?: string };

/**
 * PA-9: mükerrer talebi birleştirme. Bu talep (kaynak) seçilen aynı ofis talebine (hedef) birleşir: kaynak kapanır,
 * ofise tek bildirim gider, sayfa hedef talebe geçer. Onay penceresi geri alınamazlığı açıkça söyler.
 */
export function TicketMergePanel({ ticketId, ticketNo, candidates }: { ticketId: string; ticketNo: string; candidates: MergeCandidate[] }) {
  const router = useRouter();
  const [target, setTarget] = useState(candidates[0]?.id ?? "");
  const targetLabel = candidates.find((c) => c.id === target)?.label ?? "";
  if (candidates.length === 0) {
    return <p className="text-xs text-text-muted">Bu ofisin birleştirilebilecek başka açık talebi yok.</p>;
  }
  return (
    <div className="space-y-2">
      <label htmlFor={`merge-target-${ticketId}`} className="block text-xs font-semibold text-text-muted">
        Bu talebi şu talebe birleştir
      </label>
      <Combobox
        id={`merge-target-${ticketId}`}
        options={candidates.map((c) => ({ value: c.id, label: c.label, hint: c.hint }))}
        value={target}
        onValueChange={setTarget}
        clearable={false}
        placeholder="Hedef talebi seçin"
        searchPlaceholder="Talep no ya da konu ara…"
        className="w-full"
      />
      <ConfirmDialog
        tone="danger"
        title="Talepler birleştirilsin mi?"
        description={`${ticketNo} kapanır ve ${targetLabel} talebine bağlanır. Açılış metni hedefe iç not olarak eklenir, ekler bu talepte kalır, ofise tek bildirim gider. Bu işlem geri alınamaz.`}
        confirmLabel="Birleştir"
        onConfirm={async () => {
          const fd = new FormData();
          fd.set("source_id", ticketId);
          fd.set("target_id", target);
          const r = await mergeSupportTickets(fd);
          if (r.ok && r.targetId) router.push(`/admin/tickets/${r.targetId}`);
          return r;
        }}
        trigger={
          <Button type="button" variant="secondary" size="sm" icon={GitMerge} disabled={!target} className="w-full">
            Birleştir
          </Button>
        }
      />
    </div>
  );
}
