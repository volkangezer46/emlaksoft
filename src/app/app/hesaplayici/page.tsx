import Link from "next/link";
import { Calculator, LineChart } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { cn } from "@/lib/utils";
import { CalculatorView, type CalculatorSearchParams } from "./calculator-view";
import { InvestmentView, type InvestmentSearchParams } from "../yatirim/investment-view";

export const metadata = { title: "Hesaplayıcılar" };

const TABS = [
  { id: "maliyet", label: "Alım maliyeti & kredi", href: "/app/hesaplayici", icon: Calculator },
  { id: "yatirim", label: "Yatırım getirisi", href: "/app/hesaplayici?sekme=yatirim", icon: LineChart },
] as const;

/**
 * Hesaplayıcılar: alım maliyeti & kredi + yatırım getirisi tek sayfada, iki sekme.
 * `?sekme=yatirim` yatırım analizini açar; diğer değerler ("kredi", "maliyet", boş)
 * alım maliyeti sekmesine gider (eski `?sekme=kredi` bağlantıları çalışır).
 * Eski /app/yatirim yolu parametreleri koruyarak buraya yönlendirir.
 *
 * MODÜL KAPISI: iki sekme de `valuation` — tek kapı.
 */
export default async function CalculatorsPage({
  searchParams,
}: {
  searchParams: Promise<CalculatorSearchParams & InvestmentSearchParams>;
}) {
  await requireModulePage("valuation", "/app/hesaplayici");
  const sp = await searchParams;
  const active = sp.sekme === "yatirim" ? "yatirim" : "maliyet";

  return (
    <div className="space-y-6">
      <nav aria-label="Hesaplayıcı sekmeleri" className="no-print -mx-1 overflow-x-auto px-1">
        <ul className="inline-flex min-w-max items-center gap-1 rounded-[var(--radius-card)] border border-line bg-canvas p-1">
          {TABS.map((tab) => (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={tab.id === active ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex items-center gap-2 rounded-[var(--radius-control)] px-3.5 py-1.5 text-sm font-semibold transition",
                  tab.id === active
                    ? "bg-surface text-ink-950 shadow-[var(--shadow-xs)]"
                    : "text-text-muted hover:text-ink-950",
                )}
              >
                <tab.icon className="h-3.5 w-3.5" aria-hidden />
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {active === "yatirim" ? <InvestmentView sp={sp} /> : <CalculatorView sp={sp} />}
    </div>
  );
}
