"use client";

import { Send, Trash2, Loader2 } from "lucide-react";
import { sendCampaign, deleteCampaign } from "@/app/actions/campaigns";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ROW_ACTION_ICON, rowActionClass } from "@/components/ui/list-kit/row-actions";

type CampaignRow = {
  id: string;
  status: string;
  title: string;
};

export function CampaignActions({
  campaign,
  canSend,
  canDelete,
}: {
  campaign: CampaignRow;
  canSend: boolean;
  canDelete: boolean;
}) {
  // Zamanlanmış kampanya da beklemeden kuyruğa alınabilir (sendCampaign draft|scheduled kabul eder).
  const canSendNow = canSend && (campaign.status === "draft" || campaign.status === "scheduled");

  const canDeleteNow = canDelete && campaign.status !== "sending";

  return (
    // Tek eylem satırı yüksekliği (WP3): "Kuyruğa al" ve "Sil" aynı 32 px (dokunmatikte 44 px).
    <div className="flex items-center gap-1.5">
      {canSendNow && (
        <ConfirmDialog
          trigger={
            <button
              type="button"
              title="Gönderim kuyruğuna al"
              className={rowActionClass({ phonePrimary: true })}
            >
              <Send className="h-3.5 w-3.5" /> Kuyruğa al
            </button>
          }
          title={`"${campaign.title}" kuyruğa alınsın mı?`}
          description="Teslimat arka planda küçük partilerle yürür. Her alıcının kayıtlı kanal izni, mesaj çıkmadan hemen önce yeniden kontrol edilir."
          confirmLabel="Kuyruğa al"
          tone="default"
          onConfirm={async () => {
            await sendCampaign(campaign.id);
          }}
        />
      )}
      {campaign.status === "sending" && (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-amber-50 px-3 text-xs font-semibold text-amber-700 touch:h-11">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Gönderiliyor
        </span>
      )}
      {canDeleteNow && (
        <ConfirmDialog
          trigger={
            <button
              type="button"
              title="Sil"
              className={`${ROW_ACTION_ICON} hover:text-danger-600`}
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
