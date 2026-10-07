import Link from "@/components/ui/smart-link";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sampleDataHint } from "@/lib/sample-scope";
import { cn } from "@/lib/utils";

/**
 * "Örnek veri dahil" etiketi. Etiket metni ve eşik açıklaması tek kaynaktan gelir
 * (`lib/sample-scope`: `SampleKpiScope.label`). Etiket yoksa (örnek veri rakamlara
 * karışmıyorsa) hiçbir şey çizilmez. Ana ekrandaki amber şeride giden bağlantı, örnek veriyi
 * temizlemenin yoludur.
 */
export function SampleDataBadge({ label, className }: { label: string | null | undefined; className?: string }) {
  if (!label) return null;
  return (
    <Link href="/app" title={sampleDataHint()} className={className} aria-label={`${label}. ${sampleDataHint()}`}>
      <Badge variant="warning" size="sm" dot>
        {label}
      </Badge>
    </Link>
  );
}

/**
 * "Örnek veri" KAYIT rozeti — `is_sample=true` kayıtların (müşteri, portföy detay başlığı) yanında gösterilir.
 * Kayıt gerçek kullanıma geçişte silinir (Ayarlar > Örnek veriler / ana ekran bandı); düzenlenip silinebilir
 * olmaya devam eder. KPI etiketinden (`SampleDataBadge`) ayrıdır. Sunucu ve istemci bileşenlerinde kullanılabilir.
 */
export function SampleRecordBadge({ show = true, className }: { show?: boolean | null; className?: string }) {
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
