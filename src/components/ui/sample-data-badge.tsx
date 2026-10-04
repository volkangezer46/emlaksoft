import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Örnek veri" etiketi — `is_sample=true` kayıtların yanında gösterilir. Kayıt gerçek kullanıma geçişte
 * silinir (Ayarlar > Örnek veriler / ana ekran bandı); düzenlenip silinebilir olmaya devam eder.
 * Sunucu ve istemci bileşenlerinde kullanılabilir (durumsuz).
 */
export function SampleDataBadge({ show = true, className }: { show?: boolean | null; className?: string }) {
  if (!show) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-700",
        className,
      )}
      title="Bu kayıt demo içindir; gerçek kullanıma başlayınca silinir."
    >
      <Sparkles className="h-3 w-3" aria-hidden />
      Örnek veri
    </span>
  );
}
