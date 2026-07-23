"use client";

import { useRouter } from "next/navigation";
import { useState, startTransition } from "react";
import { setDemandStatus } from "@/app/actions/demands";

export function DemandStatusButtons({
  demandId,
  customerId,
  status,
}: {
  demandId: string;
  customerId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function setStatus(next: string) {
    setPending(true);
    const fd = new FormData();
    fd.set("id", demandId);
    fd.set("customer_id", customerId);
    fd.set("status", next);
    await setDemandStatus(fd);
    startTransition(() => {
      setPending(false);
      router.refresh();
    });
  }

  if (status === "closed") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => setStatus("active")}
        className="text-[11px] font-semibold text-mint-600 hover:underline disabled:opacity-50"
      >
        Yeniden aç
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => setStatus("closed")}
      className="text-[11px] font-semibold text-text-muted hover:text-danger-500 hover:underline disabled:opacity-50"
    >
      Kapat
    </button>
  );
}
