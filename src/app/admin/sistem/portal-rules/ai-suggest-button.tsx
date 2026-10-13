"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runAiSuggest } from "@/app/actions/admin-portal-rules";
import type { TransferPortal } from "@/lib/portal-transfer/rules";

/**
 * "AI önerisi üret": katalogdaki eşleşmemiş ve en az N ofiste görülen alanlar için öneri. Portal başına 10 dakikada 1.
 * Girdi yetersizse sunucu "Yetersiz veri (...)" döner; öneriler doğrulanmamış olarak listeye düşer.
 */
export function AiSuggestButton({ portal, minTenants }: { portal: TransferPortal; minTenants: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () => {
    setMsg(null);
    start(async () => {
      const r = await runAiSuggest(portal);
      setMsg({ ok: !!r.ok, text: r.ok ? (r.notice ?? "Öneriler eklendi.") : (r.error ?? "AI önerisi üretilemedi.") });
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="flex max-w-xs flex-col items-end gap-1">
      <Button size="sm" variant="outline" icon={Sparkles} loading={pending} onClick={run} title={`En az ${minTenants} ofiste görülen eşleşmemiş alanlar için`}>
        AI önerisi üret
      </Button>
      {msg ? (
        <span role={msg.ok ? "status" : "alert"} className={`text-right text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </span>
      ) : null}
    </div>
  );
}
