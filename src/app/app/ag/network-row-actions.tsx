"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pause, Play, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  pauseNetworkListing,
  removeFromNetwork,
  respondCollabRequest,
  resumeNetworkListing,
  withdrawRequest,
  type NetworkResult,
} from "@/app/actions/network";

function useRowAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<NetworkResult>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  return { error, pending, run };
}

function RowError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-xs font-medium text-danger-600" role="alert">
      {error}
    </p>
  );
}

/** Paylaştıklarım — duraklat/sürdür + kaldır (kaldırma ConfirmDialog ister). */
export function MyListingActions({ id, status }: { id: string; status: "active" | "paused" }) {
  const { error, pending, run } = useRowAction();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {status === "active" ? (
          <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => pauseNetworkListing(id))}>
            <Pause className="h-3.5 w-3.5" /> Duraklat
          </Button>
        ) : (
          <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => resumeNetworkListing(id))}>
            <Play className="h-3.5 w-3.5" /> Sürdür
          </Button>
        )}
        <ConfirmDialog
          title="Ağdan kaldırılsın mı?"
          description="İlan ağ havuzundan çıkar; bu ilana bağlı tüm iş birliği talepleri de silinir."
          confirmLabel="Kaldır"
          trigger={
            <Button size="sm" variant="ghost" disabled={pending} aria-label="Ağdan kaldır">
              <Trash2 className="h-3.5 w-3.5" /> Kaldır
            </Button>
          }
          onConfirm={() => run(() => removeFromNetwork(id))}
        />
      </div>
      <RowError error={error} />
    </div>
  );
}

/** Gelen talep — kabul / ret. */
export function RespondButtons({ requestId }: { requestId: string }) {
  const { error, pending, run } = useRowAction();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Button size="sm" loading={pending} onClick={() => run(() => respondCollabRequest(requestId, "accept"))}>
          <Check className="h-3.5 w-3.5" /> Kabul et
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => respondCollabRequest(requestId, "reject"))}
        >
          <X className="h-3.5 w-3.5" /> Reddet
        </Button>
      </div>
      <RowError error={error} />
    </div>
  );
}

/** Gönderdiğim bekleyen talep — geri çek. */
export function WithdrawButton({ requestId }: { requestId: string }) {
  const { error, pending, run } = useRowAction();

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => withdrawRequest(requestId))}>
        <Undo2 className="h-3.5 w-3.5" /> Geri çek
      </Button>
      <RowError error={error} />
    </div>
  );
}
