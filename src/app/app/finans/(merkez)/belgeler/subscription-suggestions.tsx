"use client";

import { useState, useTransition } from "react";
import { Check, ReceiptText } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/app/toast-provider";
import { recordSubscriptionInvoice } from "@/app/actions/expense-receipts";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { formatDateTr } from "@/lib/format";
import type { SubscriptionSuggestion } from "@/lib/finance/received-invoice";

/**
 * Fiş kutusu ÖNERİSİ (WP5): EmlakSoft abonelik faturaları deftere otomatik yazılmaz. Kullanıcı "Gider olarak kaydet" derse
 * yazılım gideri borcu (`subscription.invoiced`) açılır; aynı fatura ikinci kez kaydedilmez (olay anahtarı).
 */
export function SubscriptionSuggestions({ items, canCreate }: { items: SubscriptionSuggestion[]; canCreate: boolean }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { push } = useToast();
  if (items.length === 0) return null;

  function record(id: string) {
    setBusy(id);
    startTransition(async () => {
      const res = await recordSubscriptionInvoice(id);
      setBusy(null);
      if (!res.ok) {
        push(res.error, "err");
        return;
      }
      setDone((prev) => new Set([...prev, id]));
      push(res.info ?? (res.duplicate ? "Bu fatura zaten kayıtlı." : "Abonelik faturası gider olarak kaydedildi."), res.info ? "info" : "ok");
    });
  }

  return (
    <section aria-labelledby="sub-suggest-title" className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ReceiptText className="h-4 w-4 text-accent-text" aria-hidden="true" />
        <h3 id="sub-suggest-title" className="text-sm font-semibold text-text">
          Öneri: EmlakSoft abonelik faturaları
        </h3>
        <Badge variant="info">{items.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-text-muted">
        Bu faturalar deftere kendiliğinden yazılmaz. Gider olarak kaydederseniz yazılım gideri borcu açılır; ödenmiş faturayı Alacak ve borç ekranından hesap seçerek kapatın.
      </p>
      <ul className="grid gap-2">
        {items.map((s) => {
          const recorded = done.has(s.id);
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2">
              <Link href={`/app/abonelik/fatura/${s.id}`} className="min-w-0 text-sm hover:underline">
                <span className="font-semibold text-text">{s.invoiceNo}</span>
                <span className="text-text-muted"> · {formatDateTr(s.date)} · </span>
                <span className="numeric font-semibold text-text">{formatAccountMoney(s.amount, "TRY")}</span>
                {s.paid ? <span className="text-text-muted"> · ödendi</span> : null}
              </Link>
              {recorded ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-600">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" /> Kaydedildi
                </span>
              ) : canCreate ? (
                <Button size="sm" variant="secondary" onClick={() => record(s.id)} disabled={busy !== null}>
                  {busy === s.id ? "Kaydediliyor…" : "Gider olarak kaydet"}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
