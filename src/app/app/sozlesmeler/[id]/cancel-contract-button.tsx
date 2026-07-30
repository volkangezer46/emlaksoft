"use client";

import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { cancelContract } from "@/app/actions/contracts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Sözleşmeyi "İptal" durumuna geçiren onaylı aksiyon. Yalnız iptal edilebilir
 * durumlarda (taslak/gönderildi/reddedildi) render edilir; imzalanmış veya zaten
 * iptal edilmiş sözleşmede gösterilmez. Onaydan sonra router.refresh() ile
 * detay sayfası tazelenir (server action listeyi ayrıca revalidate eder).
 */
export function CancelContractButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <button
          type="button"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-danger-500/30 px-3 py-1.5 text-xs font-semibold text-danger-600 transition hover:bg-danger-500/8"
        >
          <Ban className="h-3.5 w-3.5" /> İptal et
        </button>
      }
      title="Sözleşme iptal edilsin mi?"
      description="Sözleşme “İptal” durumuna geçer ve imza süreci durur. Bu işlem geri alınamaz."
      confirmLabel="Sözleşmeyi iptal et"
      tone="danger"
      onConfirm={async () => {
        await cancelContract(id);
        router.refresh();
      }}
    />
  );
}
