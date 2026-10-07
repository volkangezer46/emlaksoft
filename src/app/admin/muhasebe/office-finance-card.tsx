import Link from "@/components/ui/smart-link";
import { Wallet } from "lucide-react";
import type { createAdminClient } from "@/lib/supabase/admin";
import { now as clockNow } from "@/lib/clock";
import { summarizeOffice } from "@/lib/accounting/ledger";
import { formatKurus } from "@/lib/accounting/format";
import { csvDate } from "@/lib/accounting/csv";
import { loadEfBalance, loadTenantInvoices } from "@/lib/accounting/loaders";

type Admin = ReturnType<typeof createAdminClient>;

const SUB_STATUS: Record<string, string> = {
  trialing: "Deneme",
  active: "Aktif",
  past_due: "Gecikmiş",
  cancelled: "İptal",
  paused: "Duraklatıldı",
};

/**
 * Ofis 360 > Abonelik ve ödemeler: finans özeti (yalnız okuma; çağıran sayfa `billing` erişimini doğrular).
 * Rakamlar muhasebe defteriyle aynı saf hesaptan gelir (`summarizeOffice`). Kontör bakiyesi cüzdan RPC'si yoksa "etkin değil".
 */
export async function OfficeFinanceCard({
  admin,
  tenantId,
  sub,
  subscriptionHref,
}: {
  admin: Admin;
  tenantId: string;
  sub: { status: string; current_period_end?: string | null } | null;
  /** Abonelik kartının hedefi (çağıran sayfa kurar: ofis adıyla süzülmüş abonelik listesi). */
  subscriptionHref: string;
}) {
  const [rows, balance] = await Promise.all([loadTenantInvoices(admin, tenantId).catch(() => null), loadEfBalance(admin, tenantId)]);
  const fin = rows ? summarizeOffice(rows, clockNow()) : null;
  const ledger = `/admin/muhasebe/defter?${new URLSearchParams({ donem: "tumu", ofis: tenantId }).toString()}`;
  const overdueLedger = `/admin/muhasebe/defter?${new URLSearchParams({ donem: "tumu", ofis: tenantId, durum: "gecikmis" }).toString()}`;

  const items: { label: string; value: string; hint?: string; href: string }[] = [
    {
      label: "Abonelik",
      value: sub ? (SUB_STATUS[sub.status] ?? sub.status) : "Kayıt yok",
      hint: sub?.current_period_end ? `Dönem sonu ${csvDate(sub.current_period_end)}` : undefined,
      href: subscriptionHref,
    },
    {
      label: "Toplam ödeme (brüt)",
      value: fin ? formatKurus(fin.netPaidGross) : "—",
      hint: fin ? `${fin.paidCount} ödeme${fin.refundGross > 0 ? ` · ${formatKurus(fin.refundGross)} iade düşüldü` : ""}` : "okunamadı",
      href: `${ledger}&durum=paid`,
    },
    {
      label: "Son tahsilat",
      value: fin?.lastPaidAt ? csvDate(fin.lastPaidAt) : "Yok",
      href: `${ledger}&durum=paid`,
    },
    {
      label: "Açık borç",
      value: fin ? formatKurus(fin.openGross) : "—",
      hint: fin ? `${fin.openCount} açık fatura${fin.overdueCount > 0 ? ` · ${fin.overdueCount} gecikmiş` : ""}` : undefined,
      href: fin && fin.overdueCount > 0 ? overdueLedger : `${ledger}&durum=open`,
    },
    {
      label: "Kontör bakiyesi",
      value: balance.enabled ? balance.available.toLocaleString("tr-TR") : "Etkin değil",
      hint: balance.enabled
        ? `${balance.reserved.toLocaleString("tr-TR")} rezerve · ${balance.committedTotal.toLocaleString("tr-TR")} harcanan`
        : "cüzdan hazır değil",
      href: `${ledger}&tur=credit_pack`,
    },
  ];

  return (
    <section aria-labelledby="ofis-finans-baslik" className="dashboard-panel rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ofis-finans-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Wallet className="h-4 w-4 text-brand-600" /> Finans özeti
        </h2>
        <Link href={ledger} className="focus-ring text-xs font-semibold text-brand-600 hover:underline">
          Faturaları defterde aç
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {items.map((it) => (
          <Link
            key={it.label}
            href={it.href}
            className="focus-ring surface-interactive flex min-w-0 flex-col rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 transition hover:border-brand-400"
          >
            <span className="text-xs font-medium text-text-muted">{it.label}</span>
            <span className="mt-0.5 truncate font-display text-base font-extrabold text-ink-950">{it.value}</span>
            {it.hint ? <span className="text-xs text-text-faint">{it.hint}</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
