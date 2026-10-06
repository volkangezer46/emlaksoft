"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, XCircle } from "lucide-react";
import { cancelAssignment, reassignAssignment } from "@/app/actions/office-center";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/ui/form-controls";

export type AssignOption = { id: string; name: string };

/** Aktif atama satırı: iptal (gerekçe zorunlu) ve yeniden ata — satır içi panel, popup yok. */
export function AssignmentRowActions({ assignmentId, currentAdvisorId, advisors }: { assignmentId: string; currentAdvisorId: string; advisors: AssignOption[] }) {
  const [mode, setMode] = useState<"" | "cancel" | "reassign">("");
  const [reason, setReason] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();

  function run(task: () => Promise<{ ok?: boolean; error?: string; message?: string; warning?: string }>) {
    setError(null);
    start(async () => {
      const res = await task();
      if (res.error) {
        setError(res.error);
        return;
      }
      push(res.message ?? "Tamam.", "ok");
      if (res.warning) push(res.warning, "info");
      setMode("");
      setReason("");
      setTo("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="ghost" size="xs" icon={ArrowLeftRight} aria-expanded={mode === "reassign"} onClick={() => setMode(mode === "reassign" ? "" : "reassign")}>
          Yeniden ata
        </Button>
        <Button type="button" variant="ghost" size="xs" icon={XCircle} aria-expanded={mode === "cancel"} onClick={() => setMode(mode === "cancel" ? "" : "cancel")}>
          İptal et
        </Button>
      </div>
      {mode === "cancel" ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-2">
          <label className="min-w-56 flex-1 text-xs font-medium text-ink-950">
            İptal gerekçesi
            <FormInput className="mt-1 h-8 text-xs" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="En az 3 karakter" />
          </label>
          <Button type="button" variant="danger" size="sm" loading={pending} disabled={reason.trim().length < 3} onClick={() => run(() => cancelAssignment({ assignmentId, reason }))}>
            Atamayı iptal et
          </Button>
        </div>
      ) : null}
      {mode === "reassign" ? (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-2">
          <label className="text-xs font-medium text-ink-950">
            Yeni danışman
            <FormSelect className="mt-1 h-8 w-auto px-2 py-1 text-xs" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Seçin…</option>
              {advisors
                .filter((a) => a.id !== currentAdvisorId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </FormSelect>
          </label>
          <label className="min-w-48 flex-1 text-xs font-medium text-ink-950">
            Gerekçe (isteğe bağlı)
            <FormInput className="mt-1 h-8 text-xs" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button type="button" size="sm" loading={pending} disabled={!to} onClick={() => run(() => reassignAssignment({ assignmentId, advisorId: to, reason }))}>
            Yeniden ata
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-xs font-medium text-danger-600">{error}</p> : null}
    </div>
  );
}
