"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, UserCheck, Workflow } from "lucide-react";
import { BulkBar } from "@/components/ui/list-kit";
import { Button } from "@/components/ui/button";
import { useBulkSelection } from "@/components/app/bulk-selection";
import { useToast } from "@/components/app/toast-provider";
import { bulkAssignDeals, bulkUpdateDealStage } from "@/app/actions/deals";
import { exportDealsCsv } from "@/app/actions/export";
import { downloadCsv } from "@/lib/download-csv";

/**
 * Anlaşma listesi toplu işlem çubuğu: açık aşamalar arası geçiş, danışman ataması (yönetim)
 * ve seçili satırların CSV'si. Kazanma/kayıp toplu yapılmaz (komisyon ve kayıp nedeni tekil).
 */
export function DealBulkBar({
  stages,
  members,
  canAssign,
}: {
  stages: { value: string; label: string }[];
  members: { id: string; name: string }[];
  canAssign: boolean;
}) {
  const { selected, clear } = useBulkSelection();
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState("");
  const [assignee, setAssignee] = useState("");
  if (selected.size === 0) return null;
  const ids = [...selected];

  function report(res: { error?: string; updated?: number; failed?: number; firstError?: string }, verb: string) {
    if (res.error) {
      push(res.error, "err");
      return;
    }
    const failed = res.failed ?? 0;
    push(
      `${res.updated ?? 0} anlaşma ${verb}${failed > 0 ? ` · ${failed} başarısız${res.firstError ? `: ${res.firstError}` : ""}` : ""}`,
      failed > 0 ? "err" : "ok",
    );
    clear();
    router.refresh();
  }

  return (
    <BulkBar count={selected.size} noun="anlaşma" onClear={clear}>
      <label className="sr-only" htmlFor="deal-bulk-stage">Yeni aşama</label>
      <select
        id="deal-bulk-stage"
        value={stage}
        onChange={(e) => setStage(e.target.value)}
        className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm"
      >
        <option value="">Aşama seç…</option>
        {stages.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        disabled={!stage}
        onClick={() => startTransition(async () => report(await bulkUpdateDealStage(ids, stage), "aşaması değişti"))}
      >
        <Workflow className="h-3.5 w-3.5" /> Aşamayı uygula
      </Button>
      {canAssign ? (
        <>
          <label className="sr-only" htmlFor="deal-bulk-assignee">Danışman</label>
          <select
            id="deal-bulk-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm"
          >
            <option value="">Danışman seç…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            disabled={!assignee}
            onClick={() => startTransition(async () => report(await bulkAssignDeals(ids, assignee), "atandı"))}
          >
            <UserCheck className="h-3.5 w-3.5" /> Ata
          </Button>
        </>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await exportDealsCsv(ids);
            if (res.error || !res.csv) {
              push(res.error ?? "İndirilecek kayıt yok", "err");
              return;
            }
            downloadCsv(res.csv, res.filename ?? "anlasmalar.csv");
            push(`${res.rowCount ?? 0} anlaşma CSV olarak indirildi`, "ok");
          })
        }
      >
        <Download className="h-3.5 w-3.5" /> CSV
      </Button>
    </BulkBar>
  );
}
