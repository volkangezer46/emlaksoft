import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { financePath } from "@/lib/finance/routes";
import { formatDateTr, formatTryDecimal } from "@/lib/format";
import {
  EXPENSE_CLAIM_HREF,
  expenseClaimCategoryLabel,
  expenseClaimStatusLabel,
} from "@/lib/finance/expense-claim";
import { ReceiptPreview } from "./receipt-preview";

export const metadata = { title: "Masraf bildirimi" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tek masraf bildirimi: tutar, gün, tür, durum ve fiş. Görünürlük RLS'tedir (talep sahibi, muhasebe görme yetkisi,
 * onay kararı verebilen); göremeyen için kayıt yok sayılır (404). Onay satırının açıklaması bu sayfaya bağlanır.
 */
export default async function ExpenseClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { tenantId, userId } = await requireModulePage("dashboard", financePath("kayit"));
  const supabase = await createClient();
  const { data: claim } = await supabase
    .from("expense_claims")
    .select("id, claimant_id, amount, spent_on, category, description, status, receipt_mime, approval_request_id, created_at, decided_at, claimant:profiles!expense_claims_claimant_id_fkey(full_name)")
    .eq("id", id)
    .eq("tenant_id", tenantId ?? "")
    .maybeSingle();
  if (!claim) notFound();
  const claimant = (claim as { claimant?: { full_name?: string | null } | null }).claimant?.full_name ?? "Danışman";
  const mine = claim.claimant_id === userId;
  const status = String(claim.status);
  const approvalHref = `/app/onaylar?durum=${status === "bekliyor" ? "bekliyor" : status === "iptal" ? "iptal" : status}${mine ? "&kim=benim" : ""}`;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <PageHeader
        icon={<IconChip icon={ReceiptText} size="lg" />}
        eyebrow="Masraf bildirimi"
        title={String(claim.description)}
        breadcrumbs={[{ label: "Masraf bildir", href: EXPENSE_CLAIM_HREF }, { label: "Bildirim" }]}
        description={`${mine ? "Sizin bildiriminiz" : claimant} · ${expenseClaimStatusLabel(status)}`}
      />
      <Card className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        <div>
          <p className="text-xs font-semibold text-text-muted">Tutar</p>
          <p className="numeric text-lg font-bold text-ink-950">{formatTryDecimal(Number(claim.amount))}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Harcama günü</p>
          <p className="text-sm font-semibold text-ink-950">{formatDateTr(String(claim.spent_on))}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Masraf türü</p>
          <p className="text-sm font-semibold text-ink-950">{expenseClaimCategoryLabel(String(claim.category))}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-muted">Durum</p>
          <p className="text-sm font-semibold text-ink-950">
            {expenseClaimStatusLabel(status)}
            {claim.approval_request_id ? (
              <>
                {" · "}
                <Link href={approvalHref} className="text-brand-600 hover:underline">Onaylarda aç</Link>
              </>
            ) : null}
          </p>
        </div>
      </Card>
      <Card className="p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-950">Fiş</h2>
        <ReceiptPreview claimId={String(claim.id)} isPdf={claim.receipt_mime === "application/pdf"} />
      </Card>
    </div>
  );
}
