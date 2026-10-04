import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { sampleDataHint } from "@/lib/sample-scope";

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
