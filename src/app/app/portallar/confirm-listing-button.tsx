"use client";

import { createContext, useContext, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { confirmPortalListing } from "@/app/actions/portal-listings";
import { useToast } from "@/components/app/toast-provider";

/**
 * Toplu teyitte satır butonlarının da anında "Teyit edildi" görünmesi için
 * BulkConfirmForm'un sağladığı teyitli ilan kümesi (id seti).
 */
export const ConfirmedListingsContext = createContext<ReadonlySet<string>>(new Set());

/**
 * Teyit butonu — sayfaya özel küçük client bileşen.
 *
 * React 19 optimistic desen: tıklandığı AN buton yeşil "Teyit edildi ✓"
 * durumuna geçer ve kilitlenir; server action arkada çalışır. Başarıda kalıcı
 * state ile teyitli kalır, hatada optimistic değer kendiliğinden geri sarılır
 * (+ toast ve refresh).
 */
export function ConfirmListingButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [optimisticConfirmed, setOptimisticConfirmed] = useOptimistic(savedConfirmed);
  const bulkConfirmed = useContext(ConfirmedListingsContext);
  const confirmed = optimisticConfirmed || bulkConfirmed.has(listingId);

  function submitConfirm() {
    if (confirmed || pending) return; // çifte tıklama koruması
    startTransition(async () => {
      setOptimisticConfirmed(true); // buton ANINDA teyitli görünür
      const fd = new FormData();
      fd.set("id", listingId);
      try {
        await confirmPortalListing(fd);
        setSavedConfirmed(true); // revalidate sonrası da teyitli kalsın
      } catch {
        push("Teyit edilemedi", "err");
        router.refresh();
      }
    });
  }

  if (confirmed) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-1.5 rounded-[9px] border border-mint-500/30 bg-mint-500/10 px-3 py-2 text-xs font-semibold text-mint-600"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Teyit edildi ✓
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={submitConfirm}
      disabled={pending}
      className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] border border-mint-500/20 px-3 py-2 text-xs font-semibold text-mint-600 transition hover:bg-mint-500/8 disabled:opacity-60"
    >
      <RefreshCw className="h-3.5 w-3.5" /> Teyit
    </button>
  );
}
