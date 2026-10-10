import Link from "@/components/ui/smart-link";
import { FileText, Plug } from "lucide-react";
import type { InvoiceButtonContext } from "@/lib/integrations/einvoice/service";

const STATUS_TEXT = { draft: "Taslağı aç", issued: "Faturayı gör", error: "Hatayı gör", cancelled: "Faturayı gör" } as const;

/**
 * "Fatura kes" düğmesi. Bağlantı yoksa "e-Fatura'yı bağla" der; kaynak zaten faturalıysa mevcut faturaya götürür.
 * Sunucu bileşeni (bağlam sayfa başına bir kez `loadInvoiceButtonContext` ile yüklenir). `relative z-10`: satır
 * bağlantı kaplamalı tablolarda tıklanabilir kalsın.
 */
export function InvoiceCutButton({
  ctx,
  sourceId,
  kaynak = "komisyon",
}: {
  ctx: InvoiceButtonContext;
  sourceId: string;
  kaynak?: "komisyon" | "kira_ucret";
}) {
  if (!ctx.canInvoice) return null;
  const cls =
    "focus-ring relative z-10 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-accent-text transition hover:border-brand-300";
  if (!ctx.connected) {
    return (
      <Link href="/app/ayarlar/entegrasyonlar#e-fatura" className={cls}>
        <Plug className="h-3.5 w-3.5" aria-hidden="true" /> e-Fatura&apos;yı bağla
      </Link>
    );
  }
  const found = ctx.existing[sourceId];
  if (found) {
    const href = found.status === "draft" ? `/app/giderler?sekme=faturalar&duzenle=${found.id}` : `/app/giderler?sekme=faturalar&durum=${found.status}`;
    return (
      <Link href={href} className={cls}>
        <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {STATUS_TEXT[found.status]}
      </Link>
    );
  }
  return (
    <Link href={`/app/giderler?sekme=faturalar&kaynak=${kaynak}&id=${sourceId}`} className={cls}>
      <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Fatura kes
    </Link>
  );
}
