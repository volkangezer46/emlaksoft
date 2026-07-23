"use client";

import { useTransition } from "react";
import { Send, Trash2, Loader2 } from "lucide-react";
import { sendCampaign, deleteCampaign } from "@/app/actions/campaigns";

type CampaignRow = {
  id: string;
  status: string;
  title: string;
};

export function CampaignActions({
  campaign,
  canSend,
}: {
  campaign: CampaignRow;
  canSend: boolean;
}) {
  const [sending, startSend] = useTransition();
  const [deleting, startDelete] = useTransition();

  const canSendNow =
    canSend &&
    (campaign.status === "draft" || campaign.status === "scheduled") &&
    !sending;

  const canDelete =
    canSend &&
    campaign.status !== "sending" &&
    !deleting;

  function handleSend() {
    if (!canSendNow) return;
    if (!confirm(`"${campaign.title}" kampanyası gönderilsin mi? Bu işlem geri alınamaz.`)) return;
    startSend(async () => { await sendCampaign(campaign.id); });
  }

  function handleDelete() {
    if (!canDelete) return;
    if (!confirm(`"${campaign.title}" silinsin mi?`)) return;
    startDelete(async () => { await deleteCampaign(campaign.id); });
  }

  return (
    <div className="flex items-center gap-1.5">
      {canSendNow && (
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          title="Gönder"
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Gönder
        </button>
      )}
      {campaign.status === "sending" && (
        <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Gönderiliyor
        </span>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          title="Sil"
          className="grid h-7 w-7 place-items-center rounded-[8px] text-text-muted transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          aria-label="Kampanyayı sil"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
