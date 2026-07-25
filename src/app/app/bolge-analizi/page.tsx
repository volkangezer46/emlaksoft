import Link from "next/link";
import { ArrowUpRight, Building2, Info, MapPinned, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DataTable } from "@/components/ui/data-table";
import { ChartFrame, BarCompare } from "@/components/ui/chart";
import { compareTr } from "@/lib/tr-text";

export const metadata = { title: "Bölge Analizi" };

type RegionRow = {
  district_id: string;
  district_name: string;
  province_name: string;
  active_count: number;
  total_count: number;
  median_sqm_price: number | null;
  min_sqm_price: number | null;
  max_sqm_price: number | null;
  avg_days_listed: number | null;
  closed_count: number;
  closed_value: number;
  price_change_pct: number | null;
};

const TX_FILTERS = [
  { value: "", label: "Tümü" },
  { value: "Satılık", label: "Satılık" },
  { value: "Kiralık", label: "Kiralık" },
] as const;

const PERIODS = [
  { value: "6", label: "6 ay" },
  { value: "12", label: "12 ay" },
  { value: "24", label: "24 ay" },
] as const;

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/**
 * Bölge Analizi — ilçe bazlı piyasa görünümü.
 *
 * KAYNAK: Yalnızca ofisin KENDİ portföy ve anlaşma verisi. Hiçbir dış siteden
 * veri kazınmıyor; Endeksa/Tapusor gibi sözleşmeli kaynaklar anahtar
 * tanımlıysa değerleme akışında ayrıca devreye giriyor.
 *
 * NEDEN ŞİMDİ MÜMKÜN: Bu sayfa `properties.district_id` olmadan anlamsızdı ve
 * o kolon hiçbir form tarafından doldurulmuyordu. İlçe seçimi eklendikten
 * sonra veri birikmeye başlıyor.
 */
export default async function RegionAnalysisPage({
  searchParams,
}: {
  searchParams?: Promise<{ tx?: string; months?: string }>;
}) {
  const { tenantId } = await requireModulePage("reports");
  const params = (await searchParams) ?? {};
  const tx = TX_FILTERS.some((f) => f.value === params.tx) ? (params.tx ?? "") : "";
  // Serbest metni doğrudan RPC'ye geçirmiyoruz: yalnızca beyaz listedeki değer.
  const months = PERIODS.some((p) => p.value === params.months) ? Number(params.months) : 12;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("region_stats", {
    p_tenant_id: tenantId,
    p_transaction_type: tx || null,
    p_months_back: months,
  });

  const rows = ((data ?? []) as RegionRow[]).map((r) => ({
    ...r,
    median_sqm_price: r.median_sqm_price != null ? Number(r.median_sqm_price) : null,
    closed_value: Number(r.closed_value ?? 0),
    avg_days_listed: r.avg_days_listed != null ? Number(r.avg_days_listed) : null,
    price_change_pct: r.price_change_pct != null ? Number(r.price_change_pct) : null,
  }));

  const totalActive = rows.reduce((s, r) => s + r.active_count, 0);
  const totalClosed = rows.reduce((s, r) => s + r.closed_count, 0);
  const totalClosedValue = rows.reduce((s, r) => s + r.closed_value, 0);
  const priced = rows.filter((r) => r.median_sqm_price != null);
  // Ofis geneli medyan: ilçe medyanlarının medyanı değil, ilçe sayısına göre
  // ağırlıksız ortanca — tek bir ilçedeki çok sayıda ilan tabloyu ezmesin.
  const sortedMedians = priced.map((r) => r.median_sqm_price as number).sort((a, b) => a - b);
  const officeMedian = sortedMedians.length
    ? sortedMedians[Math.floor(sortedMedians.length / 2)]
    : null;

  const chartData = [...priced]
    .sort((a, b) => (b.median_sqm_price ?? 0) - (a.median_sqm_price ?? 0))
    .slice(0, 8)
    .map((r) => ({ district: r.district_name, sqm: r.median_sqm_price ?? 0, active: r.active_count }));

  const tableRows = [...rows]
    .sort((a, b) => b.active_count - a.active_count || compareTr(a.district_name, b.district_name))
    .map((r) => ({
      id: r.district_id,
      district: r.district_name,
      province: r.province_name,
      active: r.active_count,
      total: r.total_count,
      sqm: r.median_sqm_price,
      days: r.avg_days_listed,
      closed: r.closed_count,
      value: r.closed_value,
      trend: r.price_change_pct,
      // Satır tıklanabilir: ilçe adıyla portföy listesine süz.
      _href: `/app/portfoyler?q=${encodeURIComponent(r.district_name)}`,
    }));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-12 -top-20 h-60 w-60 rounded-full bg-mint-500/25 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <MapPinned className="h-3.5 w-3.5" /> Kendi verinizden piyasa görünümü
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Bölge analizi</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            İlçe bazında medyan m² fiyatı, listede kalma süresi ve kapanan işlem hacmi.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "İlçe", value: String(rows.length), icon: MapPinned },
              { label: "Aktif portföy", value: String(totalActive), icon: Building2 },
              { label: "Medyan m²", value: money(officeMedian), icon: TrendingUp },
              { label: `Kapanan (${months} ay)`, value: `${totalClosed}`, icon: ArrowUpRight },
            ].map((item) => (
              <div key={item.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                <item.icon className="h-4 w-4 text-mint-400" />
                <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                <p className="text-[10px] text-white/45 sm:text-xs">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Filtreler <form> degil <Link>: iki dugme grubu da ayni "tx"/"months"
          parametrelerini tasiyor. Tek form icinde hem gizli input hem ayni adli
          submit dugmesi olsaydi parametre iki kez gonderilir ve hangisinin
          okunacagi belirsiz kalirdi. */}
      <nav
        aria-label="Bölge analizi filtreleri"
        className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]"
      >
        <span className="mr-1 text-xs font-semibold text-text-faint">İşlem</span>
        {TX_FILTERS.map((f) => (
          <Link
            key={f.value || "all"}
            href={`/app/bolge-analizi?tx=${encodeURIComponent(f.value)}&months=${months}`}
            aria-current={tx === f.value ? "page" : undefined}
            className={`focus-ring press rounded-[9px] px-3 py-2 text-xs font-semibold transition ${
              tx === f.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
            }`}
          >
            {f.label}
          </Link>
        ))}
        <span className="ml-3 mr-1 text-xs font-semibold text-text-faint">Dönem</span>
        {PERIODS.map((p) => (
          <Link
            key={p.value}
            href={`/app/bolge-analizi?tx=${encodeURIComponent(tx)}&months=${p.value}`}
            aria-current={String(months) === p.value ? "page" : undefined}
            className={`focus-ring press rounded-[9px] px-3 py-2 text-xs font-semibold transition ${
              String(months) === p.value ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <p className="rounded-[14px] border border-danger-500/30 bg-danger-500/5 px-4 py-3 text-sm text-danger-600" role="alert">
          Bölge verisi okunamadı. Lütfen sayfayı yenileyin.
        </p>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-brand-600/10 text-brand-600">
            <MapPinned className="h-8 w-8" />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">Henüz ilçe verisi yok</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-muted">
            Bu analiz portföylerin <strong>ilçe</strong> bilgisine dayanıyor. Portföy ekleme ve düzenleme
            formlarında İl / İlçe / Mahalle alanlarını doldurdukça bu sayfa kendiliğinden dolar.
          </p>
          <Link
            href="/app/portfoyler"
            className="focus-ring press mt-5 rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Portföylere git
          </Link>
        </div>
      ) : (
        <>
          {chartData.length > 1 ? (
            <ChartFrame
              title="İlçeye göre medyan m² fiyatı"
              subtitle="En yüksek 8 ilçe · ikinci seri aktif portföy sayısı"
            >
              {/* Yatay yerleşim: ilçe adları uzun ("Kahramanmaraş Onikişubat"),
                  dikey çubukta eksende üst üste biner. */}
              <BarCompare
                data={chartData}
                xKey="district"
                layout="horizontal"
                format="money"
                series={[
                  { key: "sqm", label: "Medyan m² (₺)" },
                  { key: "active", label: "Aktif portföy" },
                ]}
              />
            </ChartFrame>
          ) : null}

          <DataTable
            rows={tableRows}
            searchPlaceholder="İlçe veya il ara…"
            showTotals
            empty={{ title: "Filtreye uyan ilçe yok", description: "Arama terimini değiştirin ya da dönem filtresini genişletin." }}
            columns={[
              { key: "district", header: "İlçe", subtitleKey: "province", sortable: true },
              { key: "active", header: "Aktif", align: "right", sortable: true, total: true },
              { key: "total", header: "Toplam", align: "right", sortable: true, hideBelow: "md", total: true },
              { key: "sqm", header: "Medyan m²", align: "right", format: "money", sortable: true },
              { key: "days", header: "Ort. gün", align: "right", format: "number", sortable: true, hideBelow: "md" },
              { key: "closed", header: "Kapanan", align: "right", sortable: true, total: true },
              { key: "value", header: "Hacim", align: "right", format: "money", sortable: true, hideBelow: "lg", total: true },
              { key: "trend", header: "Fiyat değişimi", align: "right", format: "percent", sortable: true, hideBelow: "lg" },
              { key: "_href", header: "", format: "link", linkLabel: "Portföyler" },
            ]}
          />

          <p className="flex items-start gap-2 rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              Rakamlar <strong>yalnızca kendi ofis verinizden</strong> üretilir; dış piyasa endeksi değildir.
              Medyan m² fiyatı, m² bilgisi girilmiş portföylerden hesaplanır — m² alanı boş kayıtlar bu
              hesaba katılmaz. Kapanan işlem hacmi, kazanılmış anlaşmaların değer toplamıdır.
              {totalClosedValue > 0 ? ` Seçili dönemde toplam ${money(totalClosedValue)} hacim.` : ""}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
