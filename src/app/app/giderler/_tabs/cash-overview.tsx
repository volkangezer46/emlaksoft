import Link from "@/components/ui/smart-link";
import { ArrowDownCircle, ArrowUpCircle, Landmark, Wallet } from "lucide-react";
import { KpiStrip, type KpiItem } from "@/components/ui/list-kit";
import { formatAccountMoney, sumByCurrency } from "@/lib/finance/cash/money";
import type { AccountWithBalance, CashSummaryRow } from "@/lib/finance/cash/load";
import { FINANCE_BASE } from "./finance-shell";

/**
 * Özet sekmesi üst şeridi: ofis hesaplarının toplam bakiyesi + bu ay kasaya giren / kasadan çıkan.
 * Her kart ilgili filtreli sekmeye gider (sıfır çıkmaz metrik). Kişisel hesaplar ofis toplamına GİRMEZ.
 * Hesap yoksa "ilk hesabını aç" çağrısı gösterilir (sahte sıfır kart yok).
 */
export function CashOverview({ accounts, summary, today }: { accounts: readonly AccountWithBalance[]; summary: readonly CashSummaryRow[]; today: string }) {
  const office = accounts.filter((a) => a.owner_scope === "office" && !a.archived_at);
  if (accounts.filter((a) => !a.archived_at).length === 0) {
    return (
      <Link
        href={`${FINANCE_BASE}?sekme=kasa-banka`}
        className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface p-4 transition hover:border-brand-300"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-accent-soft text-accent-text"><Wallet className="h-5 w-5" aria-hidden="true" /></span>
        <span>
          <span className="block font-display text-sm font-bold text-text">İlk hesabınızı açın</span>
          <span className="block text-xs text-text-muted">Ofis kasası veya banka hesabı 10 saniyede açılır; gelir ve giderleriniz hesaba işlenir.</span>
        </span>
      </Link>
    );
  }
  if (office.length === 0) return null;

  const officeIds = new Set(office.map((a) => a.id));
  const currencyOf = new Map(office.map((a) => [a.id, a.currency]));
  const monthFrom = `${today.slice(0, 8)}01`;
  const rows = summary.filter((s) => officeIds.has(s.account_id));
  const money = (list: { currency: string; amount: number }[]) => (list.length === 0 ? formatAccountMoney(0, "TRY") : list.map((r) => formatAccountMoney(r.amount, r.currency)).join(" · "));
  const balance = sumByCurrency(office.map((a) => ({ currency: a.currency, amount: a.balance })));
  const incoming = sumByCurrency(rows.filter((r) => r.direction === "in").map((r) => ({ currency: currencyOf.get(r.account_id) ?? "TRY", amount: r.total })));
  const outgoing = sumByCurrency(rows.filter((r) => r.direction === "out").map((r) => ({ currency: currencyOf.get(r.account_id) ?? "TRY", amount: r.total })));
  const range = `from=${monthFrom}&to=${today}`;

  const items: KpiItem[] = [
    { label: "Kasa ve banka bakiyesi", value: money(balance), icon: <Landmark />, tone: "info", href: `${FINANCE_BASE}?sekme=kasa-banka`, hint: `${office.length} ofis hesabı` },
    { label: "Kasaya giren", value: money(incoming), icon: <ArrowDownCircle />, tone: "success", href: `${FINANCE_BASE}?sekme=hareketler&tur=gelir&${range}`, hint: "bu ay" },
    { label: "Kasadan çıkan", value: money(outgoing), icon: <ArrowUpCircle />, tone: "warning", href: `${FINANCE_BASE}?sekme=hareketler&tur=gider&${range}`, hint: "bu ay" },
  ];
  return <KpiStrip items={items} />;
}
