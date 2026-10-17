import Link from "@/components/ui/smart-link";
import { ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { now, trDayKey } from "@/lib/clock";
import { earningsPath } from "@/lib/finance/routes";
import { shiftDayKey } from "@/lib/finance/smart-entry";
import { financePath } from "@/lib/finance/routes";
import { formatDateTr, formatTryDecimal } from "@/lib/format";
import { OPEN_DEAL_STAGES } from "@/lib/workflow-state";
import { getStageLabels } from "@/lib/definitions";
import { stageName } from "@/lib/deal-stage-labels";
import {
  expenseClaimCategoryLabel,
  expenseClaimPath,
  expenseClaimStatusLabel,
} from "@/lib/finance/expense-claim";
import { ExpenseClaimForm } from "./expense-claim-form";

export const metadata = { title: "Masraf bildir" };

type ClaimRow = { id: string; amount: number; spent_on: string; category: string; description: string; status: string; created_at: string };

const STATUS_TONE: Record<string, string> = {
  bekliyor: "bg-amber-400/15 text-amber-700",
  onaylandi: "bg-mint-500/12 text-mint-700",
  reddedildi: "bg-danger-500/10 text-danger-600",
  iptal: "bg-ink-950/[0.06] text-text-muted",
};

/**
 * Masraf bildir (WP2): ofis defterine kayıt yetkisi olmayan danışman iş masrafını fişiyle bildirir; talep Onaylar'a
 * gider, onaylanınca danışmana ödenecek açık kalem olarak deftere işlenir. Kapı: oturum (+ paket kilidi); salt okunur
 * hesap bildirim açamaz. Aşağıda kullanıcının son bildirimleri (durum + tutar) listelenir.
 */
export default async function ExpenseClaimPage() {
  const { userId, role, perms } = await requireModulePage("dashboard", financePath("kayit"));
  const today = trDayKey(now());
  const breadcrumbs = [{ label: "Kazancım", href: earningsPath() }, { label: "Masraf bildir" }];
  const header = (
    <PageHeader
      icon={<IconChip icon={ReceiptText} size="lg" />}
      eyebrow="Masraf"
      title="Masraf bildir"
      breadcrumbs={breadcrumbs}
      description="İş için cebinizden ödediğiniz masrafı fişiyle bildirin. Yönetici onaylayınca size ödenecek tutar olarak ofis defterine işlenir."
    />
  );

  if (role === "readonly") {
    return (
      <div className="grid w-full max-w-4xl gap-4">
        {header}
        <EmptyState icon={ReceiptText} title="Salt okunur hesap masraf bildiremez" description="Masraf bildirimi ofis üyesi hesabıyla açılır." tone="amber" />
      </div>
    );
  }

  const supabase = await createClient();
  const [claimsRes, propsRes, dealsRes, stageLabels] = await Promise.all([
    supabase
      .from("expense_claims")
      .select("id, amount, spent_on, category, description, status, created_at")
      .eq("claimant_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("properties")
      .select("id, property_code, title")
      .eq("assigned_to", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("deals")
      .select("id, stage, deal_value, customer:customers!deals_customer_id_fkey(full_name)")
      .eq("assigned_to", userId)
      .in("stage", [...OPEN_DEAL_STAGES])
      .order("updated_at", { ascending: false })
      .limit(20),
    getStageLabels(),
  ]);
  const notReady = Boolean(claimsRes.error);
  const claims = (claimsRes.data ?? []) as ClaimRow[];
  const properties = (propsRes.data ?? []).map((p) => ({
    id: String(p.id),
    label: [p.property_code, p.title].filter(Boolean).join(" · ") || "Portföy",
  }));
  const deals = (dealsRes.data ?? []).map((d) => {
    const customer = (d as { customer?: { full_name?: string | null } | null }).customer?.full_name ?? null;
    const value = Number(d.deal_value);
    return {
      id: String(d.id),
      label: [customer, stageName(stageLabels, String(d.stage)), Number.isFinite(value) && value > 0 ? formatTryDecimal(value, 0) : null].filter(Boolean).join(" · "),
    };
  });
  const canOfficeEntry = effectiveHasPermission(perms, "expenses", "create");

  return (
    <div className="grid w-full max-w-4xl gap-4">
      {header}
      {canOfficeEntry ? (
        <p className="rounded-[var(--radius-control)] border border-line bg-canvas/60 px-4 py-3 text-sm text-text-muted">
          Ofis defterine doğrudan kayıt yetkiniz var.{" "}
          <Link href={financePath("kayit")} className="font-semibold text-brand-600 hover:underline">Gelir/Gider ekle</Link> sayfasını da kullanabilirsiniz.
        </p>
      ) : null}
      {notReady ? (
        <EmptyState icon={ReceiptText} title="Masraf bildirimi henüz etkin değil" description="Veritabanı güncellemesi bekleniyor; kısa süre sonra yeniden deneyin." tone="amber" />
      ) : (
        <ExpenseClaimForm today={today} minDay={shiftDayKey(today, -366)} properties={properties} deals={deals} />
      )}
      {claims.length > 0 ? (
        <Card className="p-0">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink-950 sm:px-5">Son bildirimlerim</h2>
          <ul className="divide-y divide-line">
            {claims.map((c) => (
              <li key={c.id}>
                <Link href={expenseClaimPath(c.id)} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-hover sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-950">{c.description}</span>
                    <span className="block text-xs text-text-muted">
                      {expenseClaimCategoryLabel(c.category)} · {formatDateTr(c.spent_on)}
                    </span>
                  </span>
                  <span className="numeric text-sm font-bold text-ink-950">{formatTryDecimal(Number(c.amount))}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONE[c.status] ?? STATUS_TONE.iptal}`}>{expenseClaimStatusLabel(c.status)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
