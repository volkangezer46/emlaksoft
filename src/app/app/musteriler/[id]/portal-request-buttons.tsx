"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { decideDemandUpdate, confirmRentNotice, rejectRentNotice } from "@/app/actions/portal-requests-review";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";

/**
 * Portal isteği karar düğmeleri (tek kopya; müşteri kartı ve kira detayı kullanır).
 *  - demand: arayış güncelleme isteğini onayla / reddet
 *  - rent: kiracının "Ödedim" bildirimini teyit et (tahsilat kaydı açılır) / "Hesaba geçmedi"
 * `paidOn` ekstrede eşleşen satırın tarihi (varsa) — tahsilat o tarihle kaydedilir.
 */
export function PortalRequestButtons({ kind, id, paidOn }: { kind: "demand" | "rent"; id: string; paidOn?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function run(approve: boolean) {
    start(async () => {
      const res =
        kind === "demand"
          ? await decideDemandUpdate(id, approve ? "approve" : "reject")
          : approve
            ? await confirmRentNotice({ noticeId: id, paidOn })
            : await rejectRentNotice(id);
      if (res.error) {
        toast.push(res.error, "err");
        return;
      }
      toast.push(
        res.info ??
          (kind === "demand"
            ? approve
              ? "Talep güncellendi."
              : "İstek reddedildi."
            : approve
              ? "Ödeme teyit edildi ve tahsilat kaydedildi."
              : "Bildirim reddedildi."),
        "ok",
      );
      router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" size="sm" loading={pending} onClick={() => run(true)}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> {kind === "demand" ? "Onayla ve güncelle" : "Teyit et"}
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => run(false)}>
        <X className="h-3.5 w-3.5" aria-hidden="true" /> {kind === "demand" ? "Reddet" : "Hesaba geçmedi"}
      </Button>
    </div>
  );
}
