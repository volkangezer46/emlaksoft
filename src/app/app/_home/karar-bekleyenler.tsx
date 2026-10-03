import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DashCard, SectionHeader, kpiColumns } from "@/components/ui/dashboard-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { moneyTry } from "@/lib/leak-shield";
import { cn } from "@/lib/utils";
import { loadDecisions, type HomeCtx } from "./data";

type Tone = "danger" | "warn" | "brand";
type Item = { key: string; value: string; label: string; hint: string; href: string; tone: Tone };

const TONE: Record<Tone, string> = {
  danger: "text-danger-500",
  warn: "text-amber-600",
  brand: "text-brand-600",
};

const CARD_MIN = "min-h-[9.5rem]";

export function KararBekleyenlerIskelet() {
  return (
    <div role="status" aria-busy="true" className={`${CARD_MIN} rounded-[var(--radius-panel)] border border-line bg-surface p-5`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="mt-2 h-4 w-full sm:hidden" />
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className={cn("h-24 rounded-[var(--radius-card)] sm:h-16", i === 3 && "max-sm:hidden")} />
        ))}
      </div>
    </div>
  );
}

/**
 * Yönetim rolleri (ofis sahibi / genel müdür / şube müdürü) için ana ekranın ilk bloğu.
 * Yalnız GERÇEK sayı > 0 olan kalemler görünür; hiçbiri yoksa blok hiç çizilmez. Her kalem
 * filtrelenmiş listeye gider (sıfır çıkmaz metrik).
 */
export async function KararBekleyenler({ ctx }: { ctx: HomeCtx }) {
  const d = await loadDecisions(ctx);
  const items: Item[] = [];
  if (d.approvals) {
    items.push({
      key: "onay",
      value: String(d.approvals),
      label: "Onay bekleyen talep",
      hint: "Senin kararını bekliyor",
      href: "/app/onaylar?kim=bana",
      tone: "warn",
    });
  }
  if (d.lostThisMonth && d.lostThisMonth > 0) {
    items.push({
      key: "kacan",
      value: moneyTry(d.lostThisMonth),
      label: "Bu ay kaçan komisyon",
      hint: "Kapanan ilanlardan tahmini",
      href: "/app/kayip-kacak",
      tone: "danger",
    });
  }
  if (d.overdueRent) {
    items.push({
      key: "tahsilat",
      value: String(d.overdueRent),
      label: "Geciken kira tahsilatı",
      hint: "Gecikmiş tahakkuk",
      href: "/app/kiralama?durum=overdue",
      tone: "danger",
    });
  }
  if (d.passiveAdvisors) {
    items.push({
      key: "pasif",
      value: String(d.passiveAdvisors),
      label: "Hareketsiz danışman",
      hint: `${d.passiveDays} gündür anlaşma hareketi yok`,
      href: "/app/ekip",
      tone: "brand",
    });
  }
  if (items.length === 0) return null;

  return (
    <DashCard aria-labelledby="karar-baslik" className={CARD_MIN}>
      <SectionHeader
        title={<span id="karar-baslik">Bugün karar bekleyenler</span>}
        eyebrow="Yönetim"
        description="Senin kararına ya da müdahalene bağlı kalemler. Tıklayınca ilgili liste açılır."
      />
      <ul className={cn("grid gap-3", kpiColumns(items.length))}>
        {items.map((it) => (
          <li key={it.key} className="min-w-0">
            <Link
              href={it.href}
              className="focus-ring group flex h-full items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 transition hover:border-brand-300 hover:bg-surface"
            >
              <span className="min-w-0 flex-1">
                <span className={cn("block font-display text-2xl font-bold tabular-nums", TONE[it.tone])}>{it.value}</span>
                <span className="block text-sm font-semibold text-ink-950">{it.label}</span>
                <span className="block text-xs text-text-muted">{it.hint}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-faint group-hover:text-brand-600" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </DashCard>
  );
}
