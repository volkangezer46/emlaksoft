"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { applyDemandWiden } from "@/app/actions/demands";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";
import type { WidenKind } from "@/lib/match-widen";

/** "Uygula": genişletme yaması sunucuda mevcut talepten yeniden hesaplanır; sonuç anında listeye yansır. */
export function ApplyWidenButton({ demandId, kind, gain }: { demandId: string; kind: WidenKind; gain: number }) {
  const [pending, startTransition] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      icon={Check}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const fd = new FormData();
          fd.set("id", demandId);
          fd.set("kind", kind);
          const res = await applyDemandWiden(fd);
          if (res.error) {
            push(res.error, "err");
            return;
          }
          push(`Talep güncellendi · +${gain} portföy eşleşti`, "ok");
          router.refresh();
        })
      }
    >
      Uygula
    </Button>
  );
}
