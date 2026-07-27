import Link from "next/link";
import { ArrowUpRight, Building2, Info, LineChart, MapPinned, Minus, Sparkles, Trophy, TrendingDown, TrendingUp, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DataTable } from "@/components/ui/data-table";
import { ChartFrame, BarCompare, AreaTrend } from "@/components/ui/chart";
import { compareTr } from "@/lib/tr-text";
import { now } from "@/lib/clock";
import { PrintReportButton } from "./print-report-button";

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
  searchParams?: Promise<{ tx?: string; months?: string; district?: string }>;
}) {
  const { tenantId } = await requireModulePage("reports");
  const params = (await searchParams) ?? {};
  const tx = TX_FILTERS.some((f) => f.value === params.tx) ? (params.tx ?? "") : "";
  // Serbest metni doğrudan RPC'ye geçirmiyoruz: yalnızca beyaz listedeki değer.
  const months = PERIODS.some((p) => p.value === params.months) ? Number(params.months) : 12;
  // Trend için seçili ilçe — yalnızca UUID biçimindeki değer kabul edilir.
  const districtParam =
    typeof params.district === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.district)
      ? params.district
      : "";

  const supabase = await createClient();
  // Kira çarpanı için her iki işlem tipinin medyanı gerekiyor. Ana çağrı zaten
  // bir tipe filtreliyse ikinci kez çekmeyelim — sonuç yeniden kullanılır.
  const [{ data, error }, saleRes, rentRes, officeRes] = await Promise.all([
    supabase.rpc("region_stats", {
      p_tenant_id: tenantId,
      p_transaction_type: tx || null,
      p_months_back: months,
    }),
    tx === "Satılık"
      ? Promise.resolve(null)
      : supabase.rpc("region_stats", { p_tenant_id: tenantId, p_transaction_type: "Satılık", p_months_back: months }),
    tx === "Kiralık"
      ? Promise.resolve(null)
      : supabase.rpc("region_stats", { p_tenant_id: tenantId, p_transaction_type: "Kiralık", p_months_back: months }),
    // Cep raporu başlığı için ofis adı — yalnız çıktıda kullanılır.
    tenantId
      ? supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const officeName = (officeRes?.data as { name?: string } | null)?.name ?? "Emlak ofisi";

  const rows = ((data ?? []) as RegionRow[]).map((r) => ({
    ...r,
    median_sqm_price: r.median_sqm_price != null ? Number(r.median_sqm_price) : null,
    closed_value: Number(r.closed_value ?? 0),
    avg_days_listed: r.avg_days_listed != null ? Number(r.avg_days_listed) : null,
    price_change_pct: r.price_change_pct != null ? Number(r.price_change_pct) : null,
  }));

  // İlçe → medyan m² haritaları (satılık ₺/m², kiralık aylık ₺/m²)
  const toMedianMap = (list: RegionRow[] | null) => {
    const map = new Map<string, number>();
    for (const r of list ?? []) {
      const v = r.median_sqm_price != null ? Number(r.median_sqm_price) : null;
      if (v != null && v > 0) map.set(r.district_id, v);
    }
    return map;
  };
  const saleMedians = toMedianMap(tx === "Satılık" ? rows : ((saleRes?.data ?? []) as RegionRow[]));
  const rentMedians = toMedianMap(tx === "Kiralık" ? rows : ((rentRes?.data ?? []) as RegionRow[]));

  /**
   * Kira çarpanı (amortisman yılı): satılık medyan ₺/m² ÷ (kiralık medyan
   * aylık ₺/m² × 12). Her iki tipte de veri olan ilçelerde hesaplanır.
   */
  const multiplierFor = (districtId: string): number | null => {
    const sale = saleMedians.get(districtId);
    const rent = rentMedians.get(districtId);
    if (!sale || !rent) return null;
    return Math.round((sale / (rent * 12)) * 10) / 10;
  };

  // ---- Seçili ilçenin 12 aylık medyan ₺/m² trendi (aylık snapshot'lardan) ----
  const selected = districtParam ? rows.find((r) => r.district_id === districtParam) ?? null : null;
  let trendData: Array<{ ay: string; sqm: number }> = [];
  if (selected && tenantId) {
    const { data: hist } = await supabase
      .from("region_stats_history")
      .select("period, median_sqm_price")
      .eq("tenant_id", tenantId)
      .eq("district_id", selected.district_id)
      .eq("tx_type", tx || "Tümü")
      .order("period", { ascending: false })
      .limit(12);
    const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "short", year: "2-digit" });
    trendData = (hist ?? [])
      .filter((h) => h.median_sqm_price != null)
      .reverse()
      .map((h) => ({
        ay: monthLabel.format(new Date(String(h.period))),
        sqm: Number(h.median_sqm_price),
      }));
  }

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
      // Amortisman yılı — her iki tipte medyan yoksa null → tabloda "—"
      multiplier: multiplierFor(r.district_id),
      // Satır tıklanabilir: portföyler sayfası ilçe (district) filtresi
      // desteklemediği için ilçe adıyla q araması en kesin mevcut hedef.
      _href: `/app/portfoyler?q=${encodeURIComponent(r.district_name)}`,
      // İlçe trend grafiğini açan link — mevcut filtreleri korur
      _trendHref: `/app/bolge-analizi?tx=${encodeURIComponent(tx)}&months=${months}&district=${r.district_id}#trend`,
    }));

  // Yatırımcı özeti: en düşük amortisman (en hızlı geri dönüş) ilk 3 ilçe
  const investorTop = tableRows
    .filter((r): r is typeof r & { multiplier: number } => r.multiplier != null)
    .sort((a, b) => a.multiplier - b.multiplier)
    .slice(0, 3);

  // ---- İçgörü kartları — tamamı mevcut satırlardan türetilir, sahte yok ----
  const trendHrefOf = (districtId: string) =>
    `/app/bolge-analizi?tx=${encodeURIComponent(tx)}&months=${months}&district=${districtId}#trend`;
  const fastestMarket = rows
    .filter((r) => r.avg_days_listed != null && r.active_count > 0)
    .sort((a, b) => (a.avg_days_listed as number) - (b.avg_days_listed as number))[0] ?? null;
  const hottestMarket = rows
    .filter((r) => r.price_change_pct != null && (r.price_change_pct as number) > 0)
    .sort((a, b) => (b.price_change_pct as number) - (a.price_change_pct as number))[0] ?? null;
  const deepestMarket = rows.filter((r) => r.active_count > 0).sort((a, b) => b.active_count - a.active_count)[0] ?? null;
  const biggestVolume = rows.filter((r) => r.closed_value > 0).sort((a, b) => b.closed_value - a.closed_value)[0] ?? null;
  const insightCards = [
    fastestMarket
      ? {
          key: "hiz",
          badge: "En hızlı pazar",
          district: fastestMarket.district_name,
          value: `${Math.round(fastestMarket.avg_days_listed as number)} gün`,
          note: "ortalama listede kalma",
          href: trendHrefOf(fastestMarket.district_id),
        }
      : null,
    hottestMarket
      ? {
          key: "deger",
          badge: "En çok değer kazanan",
          district: hottestMarket.district_name,
          value: `+%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(hottestMarket.price_change_pct as number)}`,
          note: `${months} ayda fiyat değişimi`,
          href: trendHrefOf(hottestMarket.district_id),
        }
      : null,
    deepestMarket
      ? {
          key: "derinlik",
          badge: "En derin pazar",
          district: deepestMarket.district_name,
          value: `${deepestMarket.active_count} aktif`,
          note: "portföy stoğu en geniş ilçe",
          href: trendHrefOf(deepestMarket.district_id),
        }
      : null,
    biggestVolume
      ? {
          key: "hacim",
          badge: "En yüksek ciro",
          district: biggestVolume.district_name,
          value: money(biggestVolume.closed_value),
          note: `${biggestVolume.closed_count} kapanan işlem`,
          href: trendHrefOf(biggestVolume.district_id),
        }
      : null,
  ].filter((c): c is NonNullable<typeof c> => c != null);

  // Trend özeti — fiyat değişimi bilinen ilçelerin yön dağılımı
  const withTrend = rows.filter((r) => r.price_change_pct != null);
  const risingCount = withTrend.filter((r) => (r.price_change_pct as number) > 0).length;
  const fallingCount = withTrend.filter((r) => (r.price_change_pct as number) < 0).length;
  const flatCount = withTrend.length - risingCount - fallingCount;

  return (
    <div className="space-y-6">
      <section className="no-print theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
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
              { label: "İlçe", value: String(rows.length), icon: MapPinned, href: null },
              { label: "Aktif portföy", value: String(totalActive), icon: Building2, href: "/app/portfoyler" },
              { label: "Medyan m²", value: money(officeMedian), icon: TrendingUp, href: null },
              { label: `Kapanan (${months} ay)`, value: `${totalClosed}`, icon: ArrowUpRight, href: "/app/anlasmalar" },
            ].map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur hover:border-white/30"
                >
                  <span className="flex items-start justify-between">
                    <item.icon className="h-4 w-4 text-mint-400" />
                    <ArrowUpRight className="hover-action h-4 w-4 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
                  </span>
                  <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                  <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
                </Link>
              ) : (
                <div key={item.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                  <item.icon className="h-4 w-4 text-mint-400" />
                  <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                  <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Filtreler <form> degil <Link>: iki dugme grubu da ayni "tx"/"months"
          parametrelerini tasiyor. Tek form icinde hem gizli input hem ayni adli
          submit dugmesi olsaydi parametre iki kez gonderilir ve hangisinin
          okunacagi belirsiz kalirdi. */}
      <nav
        aria-label="Bölge analizi filtreleri"
        className="no-print flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]"
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
          {selected ? (
            <section id="trend" className="print-sheet scroll-mt-24 space-y-4">
              {/* Ekrandaki SVG çıktıda kağıt genişliğine sığsın — Recharts genişliği
                  ölçüm anındaki piksel değeriyle sabitler. */}
              <style>{`@media print { #trend svg { max-width: 100% !important; height: auto !important; } }`}</style>

              {/* ---- CEP RAPORU BAŞLIĞI (yalnız çıktıda) ---- */}
              <header className="print-only hairline-b pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">{officeName}</p>
                    <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-950">
                      Bölge cep raporu — {selected.district_name}
                    </h1>
                    <p className="mt-1 text-sm text-text-muted">
                      {selected.province_name} / {selected.district_name} · Son {months} ay · {tx || "Satılık + Kiralık"}
                    </p>
                  </div>
                  <p className="text-right text-xs text-text-muted">
                    Rapor tarihi
                    <span className="block font-semibold text-ink-950">
                      {new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(now())}
                    </span>
                  </p>
                </div>
                {/* Anahtar göstergeler — malik sunumunun ilk bakışta okunan satırı */}
                <dl className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    ["Medyan m² fiyatı", selected.median_sqm_price != null ? money(selected.median_sqm_price) : "—"],
                    [
                      "Fiyat değişimi",
                      selected.price_change_pct != null
                        ? `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(selected.price_change_pct)}`
                        : "—",
                    ],
                    [
                      "Kira çarpanı",
                      multiplierFor(selected.district_id) != null
                        ? `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(multiplierFor(selected.district_id) as number)} yıl amortisman`
                        : "—",
                    ],
                    ["Aktif portföy", String(selected.active_count)],
                    [
                      "Ort. listede kalma",
                      selected.avg_days_listed != null ? `${Math.round(selected.avg_days_listed)} gün` : "—",
                    ],
                    [`Kapanan işlem (${months} ay)`, `${selected.closed_count} · ${money(selected.closed_value)}`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-[12px] border border-line px-3 py-2">
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{k}</dt>
                      <dd className="numeric mt-0.5 text-sm font-bold text-ink-950">{v}</dd>
                    </div>
                  ))}
                </dl>
              </header>

              <ChartFrame
                title={`${selected.district_name} — medyan m² trendi`}
                subtitle={`Son 12 ay · ${tx || "Tümü"} · aylık snapshot`}
                action={
                  <div className="no-print flex items-center gap-2">
                    <PrintReportButton />
                    <Link
                      href={`/app/bolge-analizi?tx=${encodeURIComponent(tx)}&months=${months}`}
                      className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:text-ink-950"
                      aria-label="Trend grafiğini kapat"
                    >
                      <X className="h-3.5 w-3.5" /> Kapat
                    </Link>
                  </div>
                }
                height={trendData.length >= 2 ? 260 : 120}
              >
                {trendData.length >= 2 ? (
                  <AreaTrend
                    data={trendData}
                    xKey="ay"
                    format="money"
                    series={[{ key: "sqm", label: "Medyan m² (₺)" }]}
                  />
                ) : (
                  <div className="grid h-full place-items-center rounded-[14px] border border-dashed border-line-strong bg-canvas/60 px-4 text-center">
                    <p className="text-sm text-text-muted">
                      Bu ilçe için henüz yeterli tarihçe yok — <strong>snapshot birikiyor</strong>.
                      Aylık bölge fotoğrafı alındıkça trend çizgisi burada oluşacak.
                    </p>
                  </div>
                )}
              </ChartFrame>

              {/* ---- CEP RAPORU ALT BLOĞU (yalnız çıktıda) ---- */}
              <footer className="print-only">
                <h2 className="text-sm font-bold text-ink-950">Yöntem</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                  Rakamlar yalnızca {officeName} portföy ve anlaşma verisinden üretilmiştir; dış piyasa
                  endeksi değildir. Medyan m² fiyatı, m² bilgisi girilmiş kayıtların ortancasıdır — uç
                  fiyatlar sonucu bozmaz. Kira çarpanı, satılık medyan ₺/m² değerinin yıllık kira medyanına
                  bölümüdür (amortisman yılı). Trend çizgisi aylık bölge fotoğraflarından (snapshot) gelir.
                </p>
                <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                  <span>
                    Bu rapor bilgilendirme amaçlı bir <strong>piyasa özeti</strong>dir; SPK lisanslı
                    değerleme uzmanınca düzenlenmiş resmî bir ekspertiz raporu <strong>değildir</strong> ve
                    kredi, teminat ya da resmî işlemlerde kullanılamaz. Veriler rapor tarihine aittir;
                    piyasa koşulları değiştikçe rakamlar da değişir.
                  </span>
                </p>
                <div className="mt-10 grid grid-cols-2 gap-12">
                  <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Hazırlayan · {officeName}</div>
                  <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Teslim alan · ad, soyad, tarih</div>
                </div>
              </footer>
            </section>
          ) : null}

          {insightCards.length > 0 ? (
            <section className="no-print rounded-[20px] border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                    <Sparkles className="h-4 w-4" /> İçgörüler
                  </p>
                  <h2 className="mt-1 font-display font-bold text-ink-950">Bölge içgörü kartları</h2>
                </div>
                {withTrend.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    <span className="flex items-center gap-1 rounded-full bg-mint-500/10 px-2.5 py-1 text-mint-600">
                      <TrendingUp className="h-3.5 w-3.5" /> {risingCount} ilçe yükselişte
                    </span>
                    <span className="flex items-center gap-1 rounded-full bg-danger-500/10 px-2.5 py-1 text-danger-500">
                      <TrendingDown className="h-3.5 w-3.5" /> {fallingCount} ilçe düşüşte
                    </span>
                    {flatCount > 0 ? (
                      <span className="flex items-center gap-1 rounded-full bg-ink-950/6 px-2.5 py-1 text-text-muted">
                        <Minus className="h-3.5 w-3.5" /> {flatCount} yatay
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {insightCards.map((c) => (
                  <Link
                    key={c.key}
                    href={c.href}
                    className="focus-ring press lift group block rounded-[14px] border border-line bg-canvas/60 p-4 transition hover:border-brand-300"
                  >
                    <p className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.08em] text-text-faint">
                      <span>{c.badge}</span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">{c.district}</p>
                    <p className="numeric mt-2 font-display text-2xl font-extrabold text-ink-950">{c.value}</p>
                    <p className="text-[11px] text-text-muted">{c.note}</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {investorTop.length > 0 ? (
            <section className="no-print rounded-[20px] border border-line bg-surface p-5">
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                <Trophy className="h-4 w-4" /> Yatırımcı özeti
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">En hızlı geri dönen ilçeler</h2>
              <p
                className="mt-0.5 text-[11px] text-text-muted"
                title="Kira çarpanı = satılık medyan ₺/m² ÷ (kiralık medyan aylık ₺/m² × 12). Düşük değer, kira geliriyle daha hızlı amortisman demektir."
              >
                Kira çarpanına göre — satılık fiyatın kaç yıllık kirayla karşılandığı
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {investorTop.map((r, i) => (
                  <div key={r.id} className="rounded-[14px] border border-line bg-canvas/60 p-4">
                    <p className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                      <span>#{i + 1}</span>
                      <LineChart className="h-3.5 w-3.5 text-amber-500" />
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-ink-950">{r.district}</p>
                    <p className="mt-2 font-display text-2xl font-extrabold text-ink-950">
                      {new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(r.multiplier)} yıl
                    </p>
                    <p className="text-[11px] text-text-muted">
                      amortisman · ~%{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(100 / r.multiplier)} brüt getiri
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {chartData.length > 1 ? (
            <ChartFrame
              className="no-print"
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

          <div className="no-print">
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
              // Kira çarpanı: satılık medyan ₺/m² ÷ (kiralık medyan aylık ₺/m² × 12) = amortisman yılı
              { key: "multiplier", header: "Kira çarpanı (yıl)", align: "right", format: "number", sortable: true, hideBelow: "md" },
              { key: "_trendHref", header: "", format: "link", linkLabel: "Trend", hrefKey: "_trendHref" },
              { key: "_href", header: "", format: "link", linkLabel: "Portföyler" },
            ]}
          />
          </div>

          <p className="no-print flex items-start gap-2 rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
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
