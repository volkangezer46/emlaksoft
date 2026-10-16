import Link from "@/components/ui/smart-link";
import { Copy, FileWarning, Sparkles, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import { categorySpikes, findDuplicatePayments, rankAttention, searchTextFor, type AttentionItem } from "@/lib/finance/anomalies";
import { loadAttentionSignals } from "@/lib/finance/insights-load";
import { shortDayTr } from "@/lib/finance/forecast";
import { cn } from "@/lib/utils";
import { categoryLabelMap, loadCustomCategories } from "./butce";
import { insightLinks } from "./insight-links";

/**
 * "Dikkat edilmesi gerekenler" (Genel bakış; kendi Suspense sınırında akar). Kural tabanlı, kanıtlı sinyaller:
 *  - kategori gideri önceki 3 ayın ortalamasının belirgin üstünde (oran + z-skoru) ya da yeni büyük gider kalemi
 *  - mükerrer ödeme şüphesi (aynı tutar + aynı karşı taraf, birkaç gün arayla)
 *  - bu ay belgesi eklenmemiş giderler
 * Her satır o kümeyi veren süzgeçle Hareketler'e gider. Sinyal yoksa kart hiç çizilmez (sahte uyarı yok).
 */

const money = (n: number, c = "TRY") => formatAccountMoney(n, c === "USD" || c === "EUR" ? c : "TRY");
const SEV_STYLE = {
  high: { box: "border-danger-300", icon: "bg-danger-soft text-danger-strong", label: "Önemli" },
  medium: { box: "border-amber-400", icon: "bg-warning-soft text-warning-strong", label: "Uyarı" },
  low: { box: "border-line", icon: "bg-surface-accent-soft text-accent-text", label: "Bilgi" },
} as const;

type Row = AttentionItem & { icon: typeof TrendingUp };

export async function AttentionCard({ today, canSalary }: { today: string; canSalary: boolean }) {
  const supabase = await createClient();
  const month = today.slice(0, 7);
  const monthFrom = `${month}-01`;
  const [signals, defs, custom] = await Promise.all([loadAttentionSignals(today, canSalary), getDefinitionsOrDefault("expense_category"), loadCustomCategories(supabase)]);
  const labels = categoryLabelMap(defs, custom.rows);
  const labelOf = (k: string) => labels.get(k) ?? (k === "diger_gider" ? "Kategorisiz gider" : k);

  const rows: Row[] = [];
  for (const s of categorySpikes(signals.expenseMonths, month)) {
    const href = insightLinks.categoryExpenses(s.category, monthFrom, today);
    if (s.basis === "new") {
      rows.push({
        key: `new-${s.category}`,
        severity: s.severity,
        icon: Sparkles,
        amount: s.actual,
        href,
        title: `Yeni gider kalemi: ${labelOf(s.category)} ${money(s.actual)}`,
        text: "Önceki üç ayda bu kategoride gider yoktu. Doğru kategoriye girildiğini kontrol edin.",
      });
    } else {
      const pct = Math.round(((s.ratio ?? 1) - 1) * 100);
      rows.push({
        key: `spike-${s.category}`,
        severity: s.severity,
        icon: TrendingUp,
        amount: s.actual - s.baseline,
        href,
        title: `${labelOf(s.category)} gideri ortalamanın %${pct} üstünde`,
        text: `Bu ay ${money(s.actual)} · son üç ay ortalaması ${money(s.baseline)}.`,
      });
    }
  }
  for (const d of findDuplicatePayments(signals.payments).slice(0, 3)) {
    rows.push({
      key: `dup-${d.ids.join("-")}`,
      severity: d.count >= 3 || d.amount >= 10000 ? "high" : "medium",
      icon: Copy,
      amount: d.amount * (d.count - 1),
      href: insightLinks.duplicate(searchTextFor(d.label), d.from, d.to),
      title: `Aynı ödeme birden çok kez girilmiş olabilir: ${d.label}`,
      text: `${d.count} kez ${money(d.amount, d.currency)} (${d.from === d.to ? shortDayTr(d.from) : `${shortDayTr(d.from)}–${shortDayTr(d.to)}`}). Biri yanlışlıkla iki kez girildiyse iptal edin.`,
    });
  }
  const receiptless = signals.receiptlessThisMonth ?? 0;
  if (receiptless > 0) {
    rows.push({
      key: "receiptless",
      severity: receiptless >= 10 ? "medium" : "low",
      icon: FileWarning,
      href: insightLinks.receiptless(monthFrom, today),
      title: `Bu ay belgesiz ${receiptless} gider`,
      text: "Fiş ya da faturası eklenmemiş giderler; KDV indirimi ve ay sonu kapanışı için belgeyi ekleyin.",
    });
  }

  const ranked = rankAttention(rows, 6) as Row[];
  if (ranked.length === 0) return null;

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]" aria-labelledby="fin-dikkat">
      <header className="mb-3">
        <h2 id="fin-dikkat" className="font-display text-base font-bold text-text">
          Dikkat edilmesi gerekenler
        </h2>
        <p className="text-xs text-text-muted">Giderlerinizi önceki aylarla karşılaştırır, iki kez girilmiş ve belgesiz kayıtları yakalar.</p>
      </header>
      <ul className="grid gap-2 md:grid-cols-2">
        {ranked.map((r) => {
          const st = SEV_STYLE[r.severity];
          return (
            <li key={r.key}>
              <Link
                href={r.href}
                className={cn("focus-ring press lift flex min-h-11 items-start gap-3 rounded-[var(--radius-card)] border bg-surface p-3 transition hover:border-brand-300", st.box)}
              >
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)]", st.icon)}>
                  <r.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="sr-only">{st.label}: </span>
                  <span className="block text-sm font-bold text-text">{r.title}</span>
                  <span className="block text-xs text-text-muted">{r.text}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
