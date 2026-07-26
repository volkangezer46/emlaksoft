"use client";

import { Send, Trash2, Loader2 } from "lucide-react";
import { sendCampaign, deleteCampaign } from "@/app/actions/campaigns";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  const canSendNow =
    canSend && (campaign.status === "draft" || campaign.status === "scheduled");

  const canDelete = canSend && campaign.status !== "sending";

  return (
    <div className="flex items-center gap-1.5">
      {canSendNow && (
        <ConfirmDialog
          trigger={
            <button
              type="button"
              title="Gönder"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[8px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
            >
              <Send className="h-3.5 w-3.5" /> Gönder
            </button>
          }
          title={`"${campaign.title}" gönderilsin mi?`}
          description="Mesajlar tüm alıcılara iletilir; bu işlem geri alınamaz."
          confirmLabel="Gönder"
          tone="default"
          onConfirm={async () => {
            await sendCampaign(campaign.id);
          }}
        />
      )}
      {campaign.status === "sending" && (
        <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Gönderiliyor
        </span>
      )}
      {canDelete && (
        <ConfirmDialog
          trigger={
            <button
              type="button"
              title="Sil"
              className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[8px] text-text-muted transition hover:bg-red-50 hover:text-red-600"
              aria-label="Kampanyayı sil"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          }
          title={`"${campaign.title}" silinsin mi?`}
          description="Kampanya ve alıcı kayıtları kalıcı olarak silinir; bu işlem geri alınamaz."
          confirmLabel="Sil"
          onConfirm={async () => {
            await deleteCampaign(campaign.id);
          }}
        />
      )}
    </div>
  );
}
