"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";

/** KPI kartı "⋯" menüsündeki "Kopyala": değeri ve etiketi panoya yazar (ör. "Aktif portföy: 38"). */
export function Kopyala({ text }: { text: string }) {
  const { push } = useToast();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      icon={Copy}
      className="kh-menu-item w-full justify-start"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => push("Panoya kopyalandı", "ok"))
          .catch(() => push("Panoya kopyalanamadı", "err"));
      }}
    >
      Kopyala
    </Button>
  );
}
