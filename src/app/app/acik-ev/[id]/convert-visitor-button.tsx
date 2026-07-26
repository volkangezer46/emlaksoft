"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { convertVisitorToCustomer } from "@/app/actions/open-house";
import { useToast } from "@/components/app/toast-provider";

/** Müşteriye dönüşmemiş ziyaretçiyi tek tıkla müşteri kaydına çevirir. */
export function ConvertVisitorButton({
  visitorId,
  openHouseId,
}: {
  visitorId: string;
  openHouseId: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function onConvert() {
    startTransition(async () => {
      const res = await convertVisitorToCustomer(visitorId, openHouseId);
      if (res.error) {
        push(res.error, "err");
        return;
      }
      setDone(true);
      push("Ziyaretçi müşteri olarak kaydedildi", "ok");
      router.refresh();
    });
  }

  if (done) return null;

  return (
    <button
      type="button"
      onClick={onConvert}
      disabled={pending}
      className="focus-ring press inline-flex items-center gap-1 rounded-[8px] border border-line bg-canvas px-2 py-1 text-[11px] font-semibold text-brand-600 transition hover:border-brand-300 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />}
      Müşteri olarak kaydet
    </button>
  );
}
