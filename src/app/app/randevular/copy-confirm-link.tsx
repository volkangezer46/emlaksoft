"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";

/**
 * Randevu satırında müşteri teyit linkini panoya kopyalar (sozlesmeler
 * CopySignLink deseni). SMS gitmese bile danışman linki WhatsApp'tan elle
 * iletebilsin — token zaten DB'de duruyor.
 */
export function CopyConfirmLink({ token }: { token: string }) {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/randevu-teyit/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      push("Teyit linki kopyalandı", "ok");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push("Link panoya kopyalanamadı", "err");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Teyit linkini kopyala"
      className="relative z-10 inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
    >
      {copied ? <Check className="h-3 w-3 text-mint-600" /> : <Link2 className="h-3 w-3" />} Teyit linki
    </button>
  );
}
