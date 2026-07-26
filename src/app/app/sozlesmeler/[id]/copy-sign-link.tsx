"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";

/**
 * İmzalayan satırında imza linkini panoya kopyalar.
 *
 * SMS gitmemişse (Netgsm kapalı ya da telefon yok) linki iletmenin tek yolu
 * buydu ve ekranda hiç görünmüyordu; token zaten DB'de duruyor.
 */
export function CopySignLink({ token }: { token: string }) {
  const { push } = useToast();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/imza/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      push("İmza linki kopyalandı", "ok");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push("Link panoya kopyalanamadı", "err");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="İmza linkini kopyala"
      aria-label="İmza linkini kopyala"
      className="focus-ring press grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-line text-text-muted transition hover:border-brand-300 hover:text-brand-600"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Link2 className="h-3.5 w-3.5" />}
    </button>
  );
}
