import { FINANCE_ROOT, financeHref } from "@/lib/finance/routes";
import { requireModulePage } from "@/lib/require-module-page";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Building2, HandCoins, Home, Receipt, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiStrip, StatusPill, type KpiItem } from "@/components/ui/list-kit";
import { now, trDayKey } from "@/lib/clock";
import { formatDateTr } from "@/lib/format";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { daysPastDue, num, OPEN_ITEM_SOURCE_LABEL, safeHref } from "@/lib/finance/party/aging";
import { effectiveCanAccessModule } from "@/lib/permissions-effective";
import { createClient } from "@/lib/supabase/server";
import { financeTitle } from "../_tabs/finance-shell";
import { FinanceBody, financeTabProps, type FinanceSearchParams } from "../_tabs/page-kit";

export const metadata = { title: financeTitle("tahsilat") };

/** Kira + bina aidatı + aidat borcu + mülk sahibi ödemesi: mülk yönetiminin NAKİT tarafı (`finance_open_items_v`). */
const SOURCES = ["rent", "building", "owner_payout", "due"] as const;
type Source = (typeof SOURCES)[number];
const LIST_LIMIT = 30;
const READ_CAP = 2000;

type Row = { key: string; source: Source; direction: "receivable" | "payable"; party_label: string; title: string; amount_open: unknown; due_date: string | null; href: string | null };

const SOURCE_ICON: Record<Source, ReactNode> = {
  rent: <Home />,
  building: <Building2 />,
  owner_payout: <HandCoins />,
  due: <Receipt />,
};

/**
 * Finans > Tahsilatlar (`/app/finans/tahsilat`): kira, bina aidatı ve aidat borçlarının nakit tarafı TEK listede.
 * Operasyon ekranları yerinde kalır (`/app/kiralama/<id>`, `/app/aidat`): her satır kendi ekranına gider, kart sayıları
 * Cari > Açık kalemler'in aynı süzgecine (`kaynak=`) düşer (sıfır çıkmaz metrik). Veri kopyalanmaz.
 */
export default async function TahsilatPage({ searchParams }: { searchParams?: FinanceSearchParams }) {
  const { perms } = await financeTabProps(await requireModulePage("expenses", FINANCE_ROOT), searchParams);
  const supabase = await createClient();
  const today = trDayKey(now());
  const { data, error } = await supabase
    .from("finance_open_items_v")
    .select("key, source, direction, party_label, title, amount_open, due_date, href")
    .in("source", SOURCES as unknown as string[])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(READ_CAP);
  const canRentals = effectiveCanAccessModule(perms, "rentals");

  const shortcuts = (
    <nav aria-label="Operasyon ekranları" className="grid gap-2 sm:grid-cols-2">
      {canRentals ? (
        <Link href="/app/kiralama" className="focus-ring surface-card group flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-panel)] px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text">Kira tahsilatı</span>
            <span className="block text-xs text-text-muted">Sözleşme, tahakkuk, gecikme ve depozito</span>
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint group-hover:text-accent-text" aria-hidden />
        </Link>
      ) : null}
      <Link href="/app/aidat" className="focus-ring surface-card group flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-panel)] px-4 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-text">Aidat ve bina tahsilatı</span>
          <span className="block text-xs text-text-muted">Bina tahakkuku, makbuz ve aidat borçları</span>
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint group-hover:text-accent-text" aria-hidden />
      </Link>
    </nav>
  );

  if (error) {
    return (
      <FinanceBody>
        <EmptyState icon={Wallet} tone="amber" title="Tahsilatlar şu an okunamadı" description="Sayfayı yenileyip yeniden deneyin. Operasyon ekranları aşağıda." />
        {shortcuts}
      </FinanceBody>
    );
  }

  const rows = ((data ?? []) as Row[]).filter((r) => num(r.amount_open) > 0);
  const totals = new Map<Source, { sum: number; count: number; overdue: number }>();
  for (const s of SOURCES) totals.set(s, { sum: 0, count: 0, overdue: 0 });
  for (const r of rows) {
    const t = totals.get(r.source);
    if (!t) continue;
    t.sum += num(r.amount_open);
    t.count += 1;
    if (r.due_date && daysPastDue(r.due_date, today) > 0) t.overdue += 1;
  }
  const visibleSources = SOURCES.filter((s) => s !== "rent" && s !== "owner_payout" ? true : canRentals);
  const kpis: KpiItem[] = visibleSources.map((s) => {
    const t = totals.get(s)!;
    return {
      label: s === "due" || s === "owner_payout" ? `${OPEN_ITEM_SOURCE_LABEL[s]} (borç)` : `${OPEN_ITEM_SOURCE_LABEL[s]} alacağı`,
      value: formatAccountMoney(Math.round(t.sum * 100) / 100, "TRY"),
      icon: SOURCE_ICON[s],
      tone: t.overdue > 0 ? "danger" : t.count > 0 ? "info" : "neutral",
      href: financeHref("cari", { gorunum: "acik", kaynak: s }),
      hint: t.count === 0 ? "açık kalem yok" : `${t.count} kalem${t.overdue > 0 ? ` · ${t.overdue} gecikmiş` : ""}`,
    };
  });

  const shown = rows.slice(0, LIST_LIMIT);
  return (
    <FinanceBody>
      <KpiStrip items={kpis} label="Tahsilat göstergeleri" />
      {shortcuts}
      <section aria-labelledby="tahsilat-liste" className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="tahsilat-liste" className="font-display text-base font-bold text-text">Vadesi en yakın kalemler</h2>
          {rows.length > 0 ? (
            <Link href={financeHref("cari", { gorunum: "acik" })} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline sm:min-h-8">
              Tüm açık kalemler ve yaşlandırma
            </Link>
          ) : null}
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={Wallet} tone="brand" title="Açık tahsilat yok" description="Kira, bina aidatı ve aidat borçlarında bekleyen kalem bulunmuyor. Yeni tahakkuklar burada vadesine göre sıralanır." />
        ) : (
          <ul className="grid gap-2">
            {shown.map((r) => {
              const late = r.due_date ? daysPastDue(r.due_date, today) : 0;
              const href = safeHref(r.href) ?? financeHref("cari", { gorunum: "acik", kaynak: r.source });
              return (
                <li key={r.key}>
                  <Link href={href} className="focus-ring surface-card flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-panel)] px-4 py-3 hover:border-line-strong">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text">{r.title || OPEN_ITEM_SOURCE_LABEL[r.source]}</span>
                      <span className="block truncate text-xs text-text-muted">
                        {OPEN_ITEM_SOURCE_LABEL[r.source]}
                        {r.party_label ? ` · ${r.party_label}` : ""}
                        {r.due_date ? ` · vade ${formatDateTr(r.due_date)}` : ""}
                      </span>
                    </span>
                    {late > 0 ? <StatusPill tone="danger">{late} gün gecikti</StatusPill> : null}
                    <span className={`numeric text-sm font-bold ${r.direction === "payable" ? "text-[color:var(--pm-warn-text)]" : "text-text"}`}>
                      {r.direction === "payable" ? "−" : ""}
                      {formatAccountMoney(num(r.amount_open), "TRY")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {rows.length > shown.length ? (
          <p className="text-xs text-text-muted">
            İlk {shown.length} kalem gösteriliyor ({rows.length} açık kalem). Tamamı için kartlardan ilgili açık kalem listesine geçin.
          </p>
        ) : null}
      </section>
    </FinanceBody>
  );
}
