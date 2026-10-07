import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Landmark } from "lucide-react";
import { AreaTrend, ChartFrame } from "@/app/app/_ui/lazy-chart";
import { StatRow, type StatRowItem } from "@/components/ui/stat-row";
import { getEndeksForPlace } from "@/lib/integrations/emlakfiyati/client";
import {
  EMLAKFIYATI_GUVEN_LABEL,
  EMLAKFIYATI_LEVEL_LABEL,
  EMLAKFIYATI_SOURCE_NAME,
  EMLAKFIYATI_TIP_LABEL,
  formatDonem,
  type EmlakFiyatiTip,
} from "@/lib/integrations/emlakfiyati/contract";

const SHORT_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const nf0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

function shortDonem(donem: string): string {
  const [y, m] = donem.split("-");
  return `${SHORT_MONTHS[Number(m) - 1] ?? m} ${String(y).slice(2)}`;
}

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}%${nf1.format(value)}`;
}

export type EndeksTipLink = { tip: EmlakFiyatiTip; href: string };

/**
 * EmlakFiyati bölge endeksi paneli (sunucu bileşeni). Sahte değer yok: anahtar yoksa, hata varsa ya da bölge/tür için
 * veri yoksa açık bir boş durum gösterir. Her sayı tıklanabilir ve filtrelenmiş bir hedefe gider.
 */
export async function EmlakFiyatiEndeksPanel({
  province,
  district,
  neighborhood,
  tip,
  tipLinks,
  stockHref,
  anchorId = "emlakfiyati-endeks",
  compareM2,
  showTrend = true,
}: {
  province: string | null;
  district: string | null;
  neighborhood?: string | null;
  tip: EmlakFiyatiTip;
  /** Konut/Arsa geçiş bağlantıları (verilmezse geçiş gösterilmez). */
  tipLinks?: EndeksTipLink[];
  /** Medyan/bant kutularının gideceği hedef (ör. aynı bölgedeki portföyler). */
  stockHref: string;
  anchorId?: string;
  /** Bakılan ilanın kendi TL/m² değeri (varsa bölge medyanıyla kıyaslanır). */
  compareM2?: number | null;
  showTrend?: boolean;
}) {
  const lookup = await getEndeksForPlace({ province, district, neighborhood, tip });
  const tipLabel = EMLAKFIYATI_TIP_LABEL[tip];

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-cyan-600">
        <Landmark className="h-4 w-4" /> {EMLAKFIYATI_SOURCE_NAME}
      </p>
      {tipLinks && tipLinks.length > 1 ? (
        <nav aria-label="Endeks türü" className="flex gap-1.5">
          {tipLinks.map((l) => (
            <Link
              key={l.tip}
              href={l.href}
              aria-current={l.tip === tip ? "page" : undefined}
              className={`focus-ring press rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs font-semibold transition ${
                l.tip === tip ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
              }`}
            >
              {EMLAKFIYATI_TIP_LABEL[l.tip]}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );

  if (lookup.status !== "ok") {
    const message =
      lookup.status === "disabled"
        ? "EmlakFiyati bağlantısı bu ortamda etkin değil; piyasa endeksi bağlantı tanımlanınca burada görünür."
        : lookup.status === "error"
          ? "EmlakFiyati şu an yanıt vermiyor. Kısa süre sonra kendiliğinden yeniden denenecek."
          : `Bu bölge için ${tipLabel.toLocaleLowerCase("tr-TR")} endeksi verisi bulunamadı (örneklem yetersiz ya da bölge kapsam dışı).`;
    return (
      <section
        id={anchorId}
        className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
      >
        {header}
        <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas/60 px-4 py-6 text-center text-sm text-text-muted">
          {message}
        </p>
      </section>
    );
  }

  const s = lookup.summary;
  const fallback = lookup.requestedPath != null && s.path !== lookup.requestedPath;
  const items: StatRowItem[] = [
    { label: `Medyan ₺/m² · ${s.ad}`, value: `${nf0.format(s.medianM2)} ₺`, href: stockHref, hint: EMLAKFIYATI_LEVEL_LABEL[s.level].toLocaleLowerCase("tr-TR") },
    {
      label: "Çeyrekler arası bant (P25–P75)",
      value: s.p25 != null && s.p75 != null ? `${nf0.format(s.p25)}–${nf0.format(s.p75)} ₺` : "—",
      href: stockHref,
    },
    { label: "Aylık değişim", value: pct(s.monthlyChange), href: `#${anchorId}-trend` },
    { label: "Yıllık değişim", value: pct(s.yearlyChange), href: `#${anchorId}-trend` },
  ];

  const compare =
    compareM2 != null && compareM2 > 0 && s.medianM2 > 0
      ? Math.round((compareM2 / s.medianM2 - 1) * 1000) / 10
      : null;

  const trendData = s.trend.map((p) => ({ ay: shortDonem(p.donem), sqm: p.medianM2 }));

  return (
    <section
      id={anchorId}
      className="scroll-mt-24 space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
    >
      {header}
      <div>
        <h2 className="font-display font-bold text-ink-950">
          {s.ad} · {tipLabel} · {formatDonem(s.donem)}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {s.n} ilana dayalı · güven: {EMLAKFIYATI_GUVEN_LABEL[s.guven]}
          {s.insufficient ? " · örneklem yetersiz, değerlemede düşük ağırlık" : ""}
        </p>
        {fallback ? (
          <p className="mt-1 text-xs font-semibold text-amber-600">
            Seçilen alt bölge için veri yok; {EMLAKFIYATI_LEVEL_LABEL[s.level].toLocaleLowerCase("tr-TR")} geneli gösteriliyor.
          </p>
        ) : null}
      </div>

      <StatRow items={items} label="EmlakFiyati endeks göstergeleri" />

      {compare != null && compareM2 != null ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5 text-sm text-text-muted">
          Bu ilanın m² fiyatı <strong className="text-ink-950">{nf0.format(compareM2)} ₺</strong> —{" "}
          bölge medyanının{" "}
          <strong className={compare > 10 ? "text-amber-600" : "text-ink-950"}>
            %{nf1.format(Math.abs(compare))} {compare >= 0 ? "üstünde" : "altında"}
          </strong>
          .
        </p>
      ) : null}

      {showTrend ? (
        <div id={`${anchorId}-trend`} className="scroll-mt-24">
          <ChartFrame
            title="Medyan ₺/m² trendi"
            subtitle={`Son ${trendData.length} dönem · ${EMLAKFIYATI_SOURCE_NAME}`}
            height={trendData.length >= 2 ? 220 : 110}
          >
            {trendData.length >= 2 ? (
              <AreaTrend data={trendData} xKey="ay" format="money" series={[{ key: "sqm", label: "Medyan ₺/m²" }]} />
            ) : (
              <div className="grid h-full place-items-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-canvas/60 px-4 text-center">
                <p className="text-sm text-text-muted">
                  Bu bölge için henüz tek dönem var; seri aylık biriktikçe trend çizgisi oluşacak.
                </p>
              </div>
            )}
          </ChartFrame>
        </div>
      ) : null}

      <Link
        href="/app/degerleme"
        className="focus-ring inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
      >
        Değerleme motorunda kullan <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}
