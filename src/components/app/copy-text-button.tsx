"use client";

import { ClipboardCopy } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";

/** Verilen metni tek tıkla panoya kopyalar (genel amaçlı; bağlantı, özet, rapor metni). */
export function CopyTextButton({
  text,
  label = "Kopyala",
  doneMessage = "Kopyalandı",
  variant = "secondary",
  size = "sm",
}: {
  text: string;
  label?: string;
  doneMessage?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const { push } = useToast();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      icon={ClipboardCopy}
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          push(doneMessage);
        } catch {
          push("Kopyalanamadı, tarayıcı izni gerekli", "err");
        }
      }}
    >
      {label}
    </Button>
  );
}
