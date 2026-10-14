"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { testIntegration } from "@/app/actions/platform-integrations";

/**
 * Entegrasyon kartının "Test et" düğmesi. İstek sunucu eylemiyle yapılır (anahtar istemciye inmez); sonuç düğmenin
 * altında kalır ve sayfa tazelenir (kartın "son test" satırı denetim kaydından gelir).
 */
export function IntegrationTestButton({ integration, label }: { integration: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setResult(null);
    start(async () => {
      const res = await testIntegration(integration);
      if (res.error) setResult({ ok: false, text: res.error });
      else setResult({ ok: Boolean(res.ok), text: `${res.message ?? ""} (${Math.round((res.durationMs ?? 0) / 100) / 10} sn)` });
      router.refresh();
    });
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Button variant="outline" size="xs" type="button" disabled={pending} onClick={run} aria-label={`${label} bağlantısını test et`} className="touch:h-11">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
        Test et
      </Button>
      {result ? (
        <span role={result.ok ? "status" : "alert"} className={`text-xs font-semibold ${result.ok ? "text-mint-700" : "text-danger-600"}`}>
          {result.text}
        </span>
      ) : null}
    </div>
  );
}
