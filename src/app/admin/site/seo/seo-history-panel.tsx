"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { restoreSeoHistory, type SeoActionResult } from "@/app/actions/seo-admin";
import { ResultNote } from "./seo-ui";

/** "Bu değere dön": geçmiş kaydındaki ÖNCEKİ değeri geri yükler (onaylı; geri dönüş de geçmişe düşer). */
export function HistoryRestoreButton({ id, label, at }: { id: string; label: string; at: string }) {
  const router = useRouter();
  const [res, setRes] = useState<SeoActionResult | null>(null);
  return (
    <div className="space-y-1.5">
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="secondary" icon={RotateCcw}>
            Bu değere dön
          </Button>
        }
        tone="default"
        title={`${label} ayarı ${at} öncesindeki değere dönsün mü?`}
        description="Mevcut değer yeni bir geçmiş kaydı olarak saklanır; bu işlemi de geri alabilirsiniz. Değişiklik public sayfalara en geç 60 saniyede yansır."
        confirmLabel="Geri yükle"
        onConfirm={async () => {
          const fd = new FormData();
          fd.set("id", id);
          const r = await restoreSeoHistory(fd);
          setRes(r);
          if (r.ok) router.refresh();
        }}
      />
      <ResultNote res={res} />
    </div>
  );
}
