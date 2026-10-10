"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { setListingPoolEnabled } from "@/app/actions/onboarding-wizard";

/**
 * Adım "İlan havuzu ve atama": tek anahtar. Açıkken yeni/atanmamış ilanlar uzmanlığa göre danışmanlara önerilir ve atanır;
 * kapalıyken ilan akışı olduğu gibi çalışır (varsayılan kapalı). Mod, eşik ve SLA ayrıntıları İlan havuzu sayfasındadır.
 */
export function PoolStep({ enabled, canConfigure }: { enabled: boolean; canConfigure: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(next: boolean) {
    setError(null);
    setOn(next);
    startTransition(async () => {
      const res = await setListingPoolEnabled(next);
      if (res.error) {
        setOn(!next);
        return setError(res.error);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div className="min-w-0 flex-1">
          <p id="pool-switch-label" className="text-sm font-semibold text-text">
            İlan havuzu {on ? "açık" : "kapalı"}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">Açıkken sahipsiz ilanlar uzmanlığa göre danışmanlara önerilir ve atanır.</p>
        </div>
        <Switch checked={on} onCheckedChange={toggle} disabled={!canConfigure || pending} aria-labelledby="pool-switch-label" />
      </div>
      {!canConfigure ? <Alert tone="info">Havuz ayarını yalnız ofis sahibi ve genel müdür değiştirebilir. Bu adımı atlayabilirsin.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Link href="/app/ilan-havuzu" className="focus-ring inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">
        Atama modu ve süreleri ilan havuzunda
      </Link>
    </div>
  );
}
