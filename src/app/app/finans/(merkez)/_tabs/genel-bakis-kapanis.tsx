import Link from "@/components/ui/smart-link";
import { ButtonLink } from "@/components/ui/button";
import { CheckCircle2, ChevronRight, CircleDashed, CircleHelp, Lock } from "lucide-react";
import { buildMonthCloseChecklist, monthNameTr, previousMonthKey, type CloseStatus } from "@/lib/finance/month-close";
import { loadMonthCloseSignals } from "@/lib/finance/insights-load";
import { cn } from "@/lib/utils";
import { insightLinks, monthRange } from "./insight-links";

/**
 * Ay sonu kapanış kontrol listesi (Genel bakış; kendi Suspense sınırında akar, yalnız `expenses:edit` yetkisine).
 * Geçen ay için: banka mutabakatı, incelenecekler, fişsiz gider, KDV özeti ve dönem kilidi. Her adım tek tıkla ilgili
 * süzülmüş listeye gider; adımlar bitince "Dönemi kilitle" Ayarlar > Dönem kapanışı'na götürür. Ay kilitliyse kart küçülür.
 */

const STATUS_ICON: Record<CloseStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  done: { icon: CheckCircle2, cls: "text-success-strong", label: "Tamam" },
  todo: { icon: CircleDashed, cls: "text-warning-strong", label: "Yapılacak" },
  unknown: { icon: CircleHelp, cls: "text-text-faint", label: "Okunamadı" },
};

export async function MonthCloseCard({ today, canSalary, reviewCount }: { today: string; canSalary: boolean; reviewCount: number | null }) {
  const monthKey = previousMonthKey(today);
  const { from, to } = monthRange(monthKey);
  const s = await loadMonthCloseSignals(monthKey, canSalary);
  const res = buildMonthCloseChecklist(
    {
      monthKey,
      locked: s.locked,
      unreconciledBank: s.unreconciledBank,
      reviewCount,
      receiptlessExpenses: s.receiptlessExpenses,
      noVatEntries: s.noVatEntries,
      vatPayable: s.vatPayable,
    },
    {
      reconcile: insightLinks.unreconciled(s.bankAccountIds, from, to),
      review: insightLinks.review(),
      receipts: insightLinks.receiptless(from, to),
      noVat: insightLinks.noVat(from, to),
      vat: insightLinks.vatYear(monthKey.slice(0, 4)),
      lock: insightLinks.periodLock(),
    },
  );
  const name = monthNameTr(monthKey);

  if (res.closed) {
    return (
      <Link
        href={insightLinks.periodLock()}
        className="focus-ring press lift flex items-center gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-300"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-success-soft text-success-strong">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </span>
        <span>
          <span className="block font-display text-sm font-bold text-text">{name} dönemi kapatıldı</span>
          <span className="block text-xs text-text-muted">Bu aya kayıt eklenemez ve değiştirilemez. Dönem kapanışı ayarlarına gidin.</span>
        </span>
      </Link>
    );
  }

  const pct = Math.round((res.done / Math.max(1, res.total)) * 100);
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-labelledby="fin-kapanis">
      <header className="mb-3 grid gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="fin-kapanis" className="font-display text-base font-bold text-text">
              Ay sonu kapanışı · {name}
            </h2>
            <p className="text-xs text-text-muted">Kontrolleri bitirip dönemi kilitleyin; mali müşavirinize temiz bir ay gider.</p>
          </div>
          <span className="numeric shrink-0 text-sm font-bold text-text">
            {res.done}/{res.total}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-label="Kapanış ilerlemesi" aria-valuemin={0} aria-valuemax={res.total} aria-valuenow={res.done}>
          <span className="block h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </header>
      <ol className="grid gap-1">
        {res.steps.map((step) => {
          const st = STATUS_ICON[step.status];
          return (
            <li key={step.key}>
              <Link
                href={step.href}
                className="focus-ring group flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 transition hover:bg-surface-hover"
              >
                <st.icon className={cn("h-5 w-5 shrink-0", st.cls)} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text">
                    {step.label}
                    <span className="sr-only"> ({st.label})</span>
                  </span>
                  <span className={cn("block text-xs", step.status === "todo" ? "text-warning-strong" : "text-text-muted")}>{step.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ol>
      {res.readyToLock ? (
        <ButtonLink href={insightLinks.periodLock()} icon={Lock} className="mt-3 w-full">
          {name} dönemini kilitle
        </ButtonLink>
      ) : null}
    </section>
  );
}
