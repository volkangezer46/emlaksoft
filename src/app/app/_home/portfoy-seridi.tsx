import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Building2, MapPin, TrendingDown } from "lucide-react";
import { trParts } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import { Widget } from "../dashboard-widgets";
import { kpiColumns } from "@/components/ui/dashboard-grid";
import { afterFirstScreen, loadPropertyStrip, type HomeCtx, type StripProperty } from "./data";
import { SekmeSerit } from "./sekme-serit";

function formatTrDate(iso: string): string {
  const p = trParts(iso);
  return `${String(p.day).padStart(2, "0")}.${String(p.month + 1).padStart(2, "0")}.${p.year}`;
}

const TX: Record<string, string> = { sale: "Satılık", rent: "Kiralık" };

function Card({ p, tone }: { p: StripProperty; tone: "new" | "drop" }) {
  return (
    <li className="min-w-0">
      <Link href={`/app/portfoyler/${p.id}`} className="pm-prop focus-ring group">
        <span className="flex items-center justify-between gap-2">
          <span className={tone === "drop" ? "pm-prop-chip pm-t-danger" : "pm-prop-chip pm-t-brand"}>
            {tone === "drop" && p.dropPct != null ? (
              <>
                <TrendingDown className="h-3 w-3" aria-hidden="true" /> %{Math.abs(p.dropPct).toLocaleString("tr-TR")} düştü
              </>
            ) : (
              <>{p.createdAt ? formatTrDate(p.createdAt) : "Yeni"}</>
            )}
          </span>
          <span className="pm-prop-code">{p.code ?? ""}</span>
        </span>
        <span className="pm-prop-price">{p.price != null ? moneyTry(p.price) : "Fiyat girilmemiş"}</span>
        <span className="pm-prop-title">{p.title ?? "Başlıksız portföy"}</span>
        <span className="pm-prop-meta">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="truncate">{p.district ?? "Konum yok"}</span>
          {p.transaction ? <span className="pm-prop-tx">{TX[p.transaction] ?? p.transaction}</span> : null}
        </span>
      </Link>
    </li>
  );
}

/**
 * Sekmeli portföy şeridi: "Son eklenenler" ve "Fiyatı düşenler" (30 gün, gerçek fiyat
 * tarihçesi). Verisi olmayan sekme hiç çizilmez; ikisi de boşsa kart gizlenir.
 * Favori/"Sana özel" gibi sekmeler için veri kaynağı olmadığından eklenmedi.
 */
export async function PortfoySeridi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.canSeeProperties) return null;
  await afterFirstScreen(ctx);
  const { recent, drops } = await loadPropertyStrip();
  const tabs = [
    recent.length > 0 && { id: "yeni", label: "Son eklenenler", count: recent.length, items: recent, tone: "new" as const },
    drops.length > 0 && { id: "dusen", label: "Fiyatı düşenler", count: drops.length, items: drops, tone: "drop" as const },
  ].filter(Boolean) as { id: string; label: string; count: number; items: StripProperty[]; tone: "new" | "drop" }[];
  if (tabs.length === 0) return null;

  return (
    <Widget id="portfoy-serit" className="h-full">
      <section className="pm-bx p-4 md:p-5" aria-labelledby="portfoy-serit-baslik">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="portfoy-serit-baslik" className="pm-bx-title flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" /> Portföy vitrini
          </h2>
          <Link href="/app/portfoyler" className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-semibold text-[var(--accent-text)]">
            Tüm portföyler <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <SekmeSerit
          ariaLabel="Portföy listeleri"
          tabs={tabs.map((t) => ({
            id: t.id,
            label: t.label,
            count: t.count,
            panel: <ul className={`grid gap-3 ${kpiColumns(t.items.length)}`}>{t.items.map((p) => <Card key={p.id} p={p} tone={t.tone} />)}</ul>,
          }))}
        />
      </section>
    </Widget>
  );
}
