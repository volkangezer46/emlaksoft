"use client";

import { useState } from "react";
import { Check, Link2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deletePresentation } from "@/app/actions/presentations";

/** Public sunum linkini panoya kopyalar — 2 sn "Kopyalandı" geri bildirimi. */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Pano izni yoksa prompt en garantili yedek (eski Safari/kiosk).
          window.prompt("Linki kopyalayın:", url);
        }
      }}
      title="Public linki kopyala"
      className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-hairline-strong bg-surface px-2.5 text-xs font-semibold text-ink-950 transition hover:bg-canvas"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? "Kopyalandı" : "Link"}
    </button>
  );
}

/** Sunum silme — ConfirmDialog + server action; public link anında ölür. */
export function DeletePresentationButton({ id, title }: { id: string; title: string }) {
  return (
    <ConfirmDialog
      trigger={
        <button
          type="button"
          title="Sunumu sil"
          className="focus-ring press grid h-8 w-8 place-items-center rounded-[8px] border border-hairline-strong bg-surface text-text-muted transition hover:border-danger-500/40 hover:text-danger-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      }
      title="Sunum silinsin mi?"
      description={`"${title}" sunumu ve public linki kalıcı olarak silinir — müşteriye gönderdiyseniz link artık açılmaz.`}
      confirmLabel="Sil"
      // ConfirmDialog formAction'ı void bekler — dönüş değeri burada bilinçli yutulur
      formAction={async (formData: FormData) => {
        await deletePresentation(formData);
      }}
      hiddenFields={{ id }}
    />
  );
}
