"use client";

import { useState, useTransition } from "react";
import { Send, X } from "lucide-react";
import {
  previewBulkMatchSend,
  sendBulkMatchToCustomers,
  type BulkMatchCounts,
} from "@/app/actions/matching-bulk";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/app/toast-provider";
import { describeMatchBulkPlan, MATCH_BULK_SEND_CAP, MATCH_BULK_SKIP_LABELS, type MatchBulkSkipReason } from "@/lib/match-bulk-send";

type Summary = BulkMatchCounts & { sent: number; failed: number; stoppedReason: string | null };

function payload(propertyId: string, demandIds: string[]): FormData {
  const fd = new FormData();
  fd.set("property_id", propertyId);
  for (const id of demandIds) fd.append("demand_ids", id);
  return fd;
}

/**
 * "Tümüne gönder (N)": tek portföye süzülmüş eşleşme ekranında (ör. fiyat düşüşü sonrası) eşleşen tüm alıcılara aynı eşleşme
 * mesajını ofisin SMS hesabından gönderir. Önce sunucu önizlemesi (İYS + engel + telefon kontrolü) onay penceresinde sayılarla
 * gösterilir; onayda gönderim sunucuda sırayla ve en fazla MATCH_BULK_SEND_CAP kişiye yapılır, sonuç özeti satır içinde kalır.
 */
export function BulkSendMatches({ propertyId, demandIds }: { propertyId: string; demandIds: string[] }) {
  const [checking, startChecking] = useTransition();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<(BulkMatchCounts & { smsReady: boolean }) | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const { push } = useToast();

  if (demandIds.length === 0) return null;

  const check = () =>
    startChecking(async () => {
      setSummary(null);
      const res = await previewBulkMatchSend(payload(propertyId, demandIds));
      if ("error" in res) {
        push(res.error, "err");
        return;
      }
      if (!res.smsReady) {
        push("SMS yapılandırması yok — Ayarlar → Entegrasyonlar bölümünden Netgsm bilgilerinizi girin.", "err");
        return;
      }
      setPreview(res);
      setOpen(true);
    });

  const confirm = async () => {
    const res = await sendBulkMatchToCustomers(payload(propertyId, demandIds));
    if ("error" in res) return res;
    setSummary(res);
    setPreview(null);
    push(`${res.sent} müşteriye gönderildi`, res.failed > 0 || res.stoppedReason ? "err" : "ok");
    return res;
  };

  const skippedLines = (s: Pick<BulkMatchCounts, "counts" | "notMatching">) =>
    [
      ...(Object.keys(s.counts) as MatchBulkSkipReason[])
        .filter((k) => s.counts[k] > 0)
        .map((k) => `${MATCH_BULK_SKIP_LABELS[k]}: ${s.counts[k]}`),
      ...(s.notMatching > 0 ? [`Artık eşleşmiyor: ${s.notMatching}`] : []),
    ].join(" · ");

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        size="sm"
        icon={Send}
        loading={checking}
        onClick={check}
        title={`Bu portföyün eşleştiği müşterilere eşleşme mesajını SMS ile gönder (en fazla ${MATCH_BULK_SEND_CAP} kişi)`}
      >
        Tümüne gönder ({demandIds.length})
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="default"
        title={preview ? `${preview.send} müşteriye SMS gönderilsin mi?` : "Toplu gönderim"}
        description={
          preview
            ? `${describeMatchBulkPlan(preview)}. İYS izni olmayan, iletişim engelli ya da geçerli cep telefonu olmayan müşterilere gönderilmez. ` +
              "Mesajlar ofisinizin SMS hesabından tek tek gönderilir; her müşteriye kendi paylaşım bağlantısı oluşturulur."
            : undefined
        }
        confirmLabel={preview ? `Gönder (${preview.send})` : "Gönder"}
        onConfirm={preview && preview.send > 0 ? confirm : async () => ({ error: "Gönderilebilecek alıcı yok." })}
      />

      {summary ? (
        <div role="status" className="flex max-w-md items-start gap-2 rounded-[var(--radius-control)] border border-line bg-surface-raised px-3 py-2 text-xs text-ink-950">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-semibold">
              {summary.sent} gönderildi{summary.failed > 0 ? ` · ${summary.failed} başarısız` : ""}
              {summary.overCap > 0 ? ` · ${summary.overCap} kişi tavan nedeniyle bu turda gönderilmedi` : ""}
            </p>
            {skippedLines(summary) ? <p className="text-text-muted">Atlanan: {skippedLines(summary)}</p> : null}
            {summary.stoppedReason ? <p className="font-semibold text-danger-600">Durduruldu: {summary.stoppedReason}</p> : null}
          </div>
          <Button variant="ghost" size="icon" icon={X} onClick={() => setSummary(null)} aria-label="Özeti kapat" className="shrink-0" />
        </div>
      ) : null}
    </div>
  );
}
