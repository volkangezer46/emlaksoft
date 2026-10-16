import Link from "@/components/ui/smart-link";
import { Landmark, Wallet, ArrowDownCircle, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { financeHref, financePath } from "@/lib/finance/routes";
import { moneyTry } from "@/lib/leak-shield";
import { loadMoneySummary, type HomeCtx } from "./data";

type Kalem = { key: string; label: string; value: number; href: string; hint: string; Icon: LucideIcon };

export function ParaOzetiIskelet() {
  return (
    <div role="status" aria-busy="true" className="ds-card ds-pad flex min-h-[18rem] flex-col gap-3">
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-5 w-20" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

/**
 * PATRON PANOSU (2) "PARA" (sadeleştirme planı 2.4 / C08): bu ay komisyon, kasa ve alacak — rakamlar varsayılan AÇIK,
 * her biri filtreli finans sayfasına gider. Kaynaklar Ofis özeti KPI'sı ve Finans genel bakışla aynıdır
 * (`loadMoneySummary`). Yetkisi olmayan kalem çizilmez; hiçbiri yoksa kart hiç çizilmez.
 */
export async function ParaOzeti({ ctx }: { ctx: HomeCtx }) {
  const m = await loadMoneySummary(ctx);
  const kalemler: Kalem[] = [];
  if (m.commissionMonth !== null) {
    kalemler.push({
      key: "komisyon",
      label: "Bu ay komisyon",
      value: m.commissionMonth,
      href: `${financePath("komisyon")}?from=${m.monthFrom}&to=${m.today}`,
      hint: ctx.seeAllEarnings ? "Ofisin bu ayki komisyonu" : "Sizin bu ayki komisyonunuz",
      Icon: Wallet,
    });
  }
  if (m.cash !== null) {
    kalemler.push({ key: "kasa", label: "Kasa", value: m.cash, href: financeHref("kasa-banka"), hint: "Kasa ve banka toplamı", Icon: Landmark });
  }
  if (m.receivable !== null) {
    kalemler.push({
      key: "alacak",
      label: "Alacak",
      value: m.receivable,
      href: financeHref("cari", { gorunum: "acik", yon: "alacak" }),
      hint: "Tahsil edilecek açık tutar",
      Icon: ArrowDownCircle,
    });
  }
  if (kalemler.length === 0) return null;
  return (
    <section aria-labelledby="para-baslik" className="ds-card ds-pad flex h-full flex-col gap-3">
      <h2 id="para-baslik" className="ds-title">
        Para
      </h2>
      <ul className="flex flex-col gap-2">
        {kalemler.map((k) => (
          <li key={k.key}>
            <Link
              href={k.href}
              data-para={k.key}
              className="focus-ring press flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface-raised px-4 py-3 transition hover:bg-surface-hover"
            >
              <k.Icon className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text">{k.label}</span>
                <span className="block truncate text-sm text-text-muted">{k.hint}</span>
              </span>
              <span className="pm-money shrink-0 font-display text-xl font-bold tabular-nums text-ink-950">{moneyTry(k.value)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
