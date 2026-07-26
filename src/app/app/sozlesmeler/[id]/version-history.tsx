"use client";

import { useState, useTransition } from "react";
import { History, RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { restoreContractVersion, type ContractVersionRow } from "@/app/actions/contracts";

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Sürüm geçmişi — içerik her düzenlendiğinde önceki hali contract_versions'a
 * yazılır; burada listelenir. "Bu sürüme dön" mevcut içeriği de yeni sürüm
 * olarak sakladıktan sonra gövdeyi seçilen sürümle değiştirir (taslakta).
 */
export function VersionHistory({
  contractId,
  versions,
  canRestore,
}: {
  contractId: string;
  versions: ContractVersionRow[];
  canRestore: boolean;
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (versions.length === 0) return null;

  function restore(versionId: string) {
    setError(null);
    startTransition(async () => {
      const res = await restoreContractVersion(contractId, versionId);
      if (res.error) setError(res.error);
    });
  }

  return (
    <details className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-display font-bold text-ink-950 [&::-webkit-details-marker]:hidden">
        <History className="h-4 w-4 text-brand-600" /> Sürüm geçmişi
        <span className="ml-auto text-xs font-normal text-text-faint">{versions.length} sürüm</span>
      </summary>

      <div className="mt-3 space-y-2">
        {versions.map((v) => (
          <div key={v.id} className="rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-bold text-brand-600">
                Sürüm {v.version_no}
              </span>
              <span className="text-xs text-text-muted">{fmtDate(v.created_at)}</span>
              {canRestore ? (
                <span className="ml-auto">
                  <ConfirmDialog
                    tone="default"
                    title={`Sürüm ${v.version_no}'e dönülsün mü?`}
                    description="Mevcut içerik kaybolmaz; geri dönmeden önce yeni bir sürüm olarak saklanır."
                    confirmLabel="Bu sürüme dön"
                    onConfirm={() => restore(v.id)}
                    trigger={
                      <button
                        type="button"
                        className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line px-2.5 py-1 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-600/5"
                      >
                        <RotateCcw className="h-3 w-3" /> Bu sürüme dön
                      </button>
                    }
                  />
                </span>
              ) : null}
            </div>
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] font-semibold text-text-muted hover:text-brand-600">
                İçeriği görüntüle
              </summary>
              <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-line bg-surface p-3 font-mono text-[11px] leading-relaxed text-text-muted">
                {v.content}
              </pre>
            </details>
          </div>
        ))}
      </div>

      {error ? (
        <p className="mt-3 rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
