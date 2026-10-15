"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, RotateCcw } from "lucide-react";
import { setConversationResolved } from "@/app/actions/communications";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";

/**
 * Konuşmayı "Tamamlandı" işaretler (yanıt gerekmeyen gelen mesaj / cevapsız arama) ya da yeniden açar.
 * Giden yanıt konuşmayı zaten kendiliğinden kapatır; bu düğme yanıtsız kapatma içindir.
 */
export function ResolveConversationButton({
  contactKey,
  waiting,
  compact = false,
}: {
  contactKey: string;
  waiting: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const Icon = waiting ? CheckCheck : RotateCcw;
  const label = waiting ? "Tamamlandı" : "Yeniden aç";

  return (
    <Button
      variant={waiting ? "navy" : "outline"}
      size="sm"
      icon={Icon}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await setConversationResolved(contactKey, waiting);
          if (res.error) {
            push(res.error, "err");
            return;
          }
          push(waiting ? "Konuşma tamamlandı" : "Konuşma yeniden açıldı", "ok");
          router.refresh();
        })
      }
      className="relative z-10"
      aria-label={compact ? label : undefined}
    >
      {compact ? <span className="sr-only sm:not-sr-only">{label}</span> : label}
    </Button>
  );
}
