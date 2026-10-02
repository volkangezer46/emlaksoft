"use client";

import { AlertTriangle, ClipboardCopy } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Portal ilan metnini (başlık/açıklama/tümü) tek tıkla panoya kopyalar. */
export function CopyListingText({
  title,
  description,
  warnings = [],
}: {
  title: string;
  description: string;
  warnings?: string[];
}) {
  const { push } = useToast();
  const run = async (text: string, what: string) => {
    if (!text) return push(`${what} üretilemedi`, "err");
    if (await copy(text)) push(`${what} kopyalandı`);
    else push("Kopyalanamadı, tarayıcı izni gerekli", "err");
  };
  const btn =
    "inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => run(`${title}\n\n${description}`, "İlan metni")}>
          <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> İlan metnini kopyala
        </button>
        <button type="button" className={btn} aria-label="Yalnız başlığı kopyala" onClick={() => run(title, "Başlık")}>
          Başlık
        </button>
        <button type="button" className={btn} aria-label="Yalnız açıklamayı kopyala" onClick={() => run(description, "Açıklama")}>
          Açıklama
        </button>
      </div>
      {warnings.length > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-300" role="note">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {warnings.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
