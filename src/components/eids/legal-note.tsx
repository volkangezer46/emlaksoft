import { Scale } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { eidsLegalNote } from "@/lib/eids/legal-text";
import type { LegalValues } from "@/lib/legal-constants";
import { cn } from "@/lib/utils";

/**
 * EİDS iptal / süre bitimi ve ceza açıklaması — TEK bileşen (görev, pano kartı, kılavuz, İlan Kontrol > Yetki).
 * Metin `src/lib/eids/legal-text.ts`'ten, ceza tutarı `legal-constants`'tan gelir; burada sayı ya da madde YAZILMAZ.
 * Sunucu ve istemci bileşeninde kullanılabilir (hook yok).
 *
 *  - `compact`: tek cümle (pano kartı, görev satırı).
 *  - `full`: maddeler + kaynak (kılavuz, görev ayrıntısı).
 */
export function EidsLegalNote({
  variant = "full",
  tone = "warning",
  values,
  className,
}: {
  variant?: "compact" | "full";
  tone?: "warning" | "danger" | "info";
  /** O gün yürürlükteki mevzuat değerleri (sunucu `getEffectiveLegalValues`); yoksa koddaki değer. */
  values?: LegalValues | null;
  className?: string;
}) {
  const note = eidsLegalNote(values);
  if (variant === "compact") {
    return (
      <p className={cn("flex items-start gap-1.5 text-xs text-text-muted", className)}>
        <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{note.headline}</span>
      </p>
    );
  }
  return (
    <Alert tone={tone} title="Yetki iptal edilirse ya da süresi biterse" className={className}>
      <ul className="list-disc space-y-1 pl-4">
        {note.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-text-muted">{note.source}</p>
    </Alert>
  );
}
