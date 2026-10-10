"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power } from "lucide-react";
import { saveListingPoolSettings } from "@/app/actions/listing-pool";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import type { PoolMode } from "@/lib/pool/modes";

/**
 * Havuz kapalıyken boş durumdaki büyük "Havuzu aç" düğmesi (yalnız ofis sahibi / genel müdür görür). Mevcut atama modu,
 * asgari puan ve süre korunarak yalnız "açık" bayrağı değişir; ayrıntılar "Atama ayarları" bölümünde.
 */
export function PoolEnableButton({ mode, minScore, slaMinutes }: { mode: PoolMode; minScore: number | null; slaMinutes: number | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const { push } = useToast();
  return (
    <Button
      type="button"
      size="lg"
      icon={Power}
      loading={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("enabled", "1");
          fd.set("mode", mode);
          if (minScore != null) fd.set("min_score", String(minScore));
          if (slaMinutes != null) fd.set("sla_minutes", String(slaMinutes));
          const res = await saveListingPoolSettings(fd);
          if (res.ok) {
            push("İlan havuzu açıldı.", "ok");
            router.refresh();
          } else push(res.error ?? "Havuz açılamadı.", "err");
        })
      }
    >
      Havuzu aç
    </Button>
  );
}
