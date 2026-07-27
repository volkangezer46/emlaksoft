import Link from "next/link";
import {
  BadgePercent,
  FileText,
  Gauge,
  Hourglass,
  Landmark,
  MapPinned,
  PiggyBank,
  Sparkles,
  Timer,
  TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { isEndeksaConfiguredFull } from "@/lib/integrations/endeksa";
import { isTapusorConfiguredFull } from "@/lib/integrations/tapusor";
import { DAY_MS } from "@/lib/clock";
import { ValuationForm } from "./valuation-form";
import { DataPartnerStatus } from "@/components/app/data-partner-badges";
import { EmptyState } from "@/components/app/empty-state";

type ValuationSource = { name: string; weight: number; value: number; note: string };

const nf0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

function money(n: number | null) {
  if (n == null) return "—";
  return nf0.format(n) + " ₺";
}

/** features.sqm — string ("120" / "120,5") ya da number gelebilir. */
function sqmOf(features: unknown): number | null {
  const raw = (features as { sqm?: number | string | null } | null)?.sqm;
  const n = typeof raw === "string" ? Number(raw.replace(",", ".")) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** D5 güven etiketi — örneklem büyüklüğüne göre. */
function confidenceOf(n: number): { label: string; cls: string } {
  if (n >= 5) return { label: "güven: yüksek", cls: "bg-mint-500/10 text-mint-600" };
  if (n >= 3) return { label: "güven: orta", cls: "bg-amber-400/15 text-amber-600" };
  return { label: "güven: düşük", cls: "bg-danger-500/10 text-danger-500" };
}

export default async function ValuationPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  await requireModulePage("valuation");
  const { property: preselectedPropertyId } = await searchParams;
  const supabase = await createClient();
  const [
    { data: valuations },
    { data: properties },
    { data: provinces },
    endeksaOn,
    tapusorOn,
    { data: analyticProps },
    { data: wonDeals },
  ] = await Promise.all([
    supabase
      .from("valuations")
      .select("id, title, estimated_low, estimated_mid, estimated_high, confidence, sources, created_at, property_id")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("properties")
      .select("id, property_code, title, list_price")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("geo_provinces").select("id, name").order("name"),
    isEndeksaConfiguredFull(),
    isTapusorConfiguredFull(),
    // D4 — kira çarpanı / getiri: fiyat + m² girilmiş portföyler (satılık ve kiralık)
    supabase
      .from("properties")
      .select("id, transaction_type, property_type, list_price, district_id, features")
      .is("deleted_at", null)
      .gt("list_price", 0)
      .limit(1000),
    // D5 — satış süresi: tenant'ın kendi kapanan anlaşmaları + bağlı portföy
    supabase
      .from("deals")
      .select("id, deal_type, created_at, updated_at, property:properties(district_id, property_type, created_at)")
      .eq("stage", "won")
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);

  const rows = valuations ?? [];
  const avgConfidence = rows.length
    ? Math.round((rows.reduce((s, v) => s + Number(v.confidence || 0), 0) / rows.length) * 100)
    : null;

  // ---------------------------------------------------------------------------
  // D4 — Kira çarpanı / getiri (yield) analizi
  // Kaynak: mevcut portföyler. Satılık medyan ₺/m² ve kiralık medyan aylık ₺/m²
  // aynı ilçede birlikte varsa: brüt getiri % = yıllık kira / satış fiyatı,
  // amortisman = satış fiyatı / yıllık kira. Sahte veri yok — hesap kurulamayan
  // ilçe listeye girmez.
  // ---------------------------------------------------------------------------
  const salePpm2 = new Map<string, number[]>(); // districtId → ₺/m² listesi
  const rentPpm2 = new Map<string, number[]>(); // districtId → aylık ₺/m² listesi
  const allSale: number[] = [];
  const allRent: number[] = [];
  for (const p of analyticProps ?? []) {
    const sqm = sqmOf(p.features);
    const price = Number(p.list_price);
    if (!sqm || !Number.isFinite(price) || price <= 0) continue;
    const ppm2 = price / sqm;
    if (p.transaction_type === "Satılık") {
      allSale.push(ppm2);
      if (p.district_id) salePpm2.set(p.district_id, [...(salePpm2.get(p.district_id) ?? []), ppm2]);
    } else if (p.transaction_type === "Kiralık") {
      allRent.push(ppm2);
      if (p.district_id) rentPpm2.set(p.district_id, [...(rentPpm2.get(p.district_id) ?? []), ppm2]);
    }
  }

  type YieldRow = {
    districtId: string;
    districtName: string;
    saleMedian: number;
    rentMedian: number;
    grossYieldPct: number; // brüt yıllık getiri %
    amortYears: number; // amortisman yılı
    sampleSale: number;
    sampleRent: number;
  };
  const yieldRows: YieldRow[] = [];
  for (const [districtId, sales] of salePpm2) {
    const rents = rentPpm2.get(districtId);
    if (!rents) continue;
    const saleMedian = median(sales);
    const rentMedian = median(rents);
    if (!saleMedian || !rentMedian) continue;
    const annualRent = rentMedian * 12;
    yieldRows.push({
      districtId,
      districtName: districtId, // isimler aşağıda çözülür
      saleMedian,
      rentMedian,
      grossYieldPct: (annualRent / saleMedian) * 100,
      amortYears: saleMedian / annualRent,
      sampleSale: sales.length,
      sampleRent: rents.length,
    });
  }

  // Ofis geneli (ilçe bilgisi eksik olsa da hesaplanabilir)
  const officeSaleMedian = median(allSale);
  const officeRentMedian = median(allRent);
  const officeYield =
    officeSaleMedian && officeRentMedian ? ((officeRentMedian * 12) / officeSaleMedian) * 100 : null;
  const officeAmort =
    officeSaleMedian && officeRentMedian ? officeSaleMedian / (officeRentMedian * 12) : null;
  // Bölge kıyası: ilçe getirilerinin medyanı — her satır buna göre rozet alır
  const districtYieldMedian = median(yieldRows.map((r) => r.grossYieldPct));

  // ---------------------------------------------------------------------------
  // D5 — Satış süresi tahmini
  // Kaynak: stage=won anlaşmalar. Süre = portföyün oluşturulma tarihi →
  // anlaşmanın kazanıldığı (son güncelleme) tarih. İlçe + tip bazında medyan gün.
  // ---------------------------------------------------------------------------
  type WonSample = { districtId: string | null; propertyType: string; days: number };
  const wonSamples: WonSample[] = [];
  for (const d of wonDeals ?? []) {
    const propRaw = d.property as
      | { district_id: string | null; property_type: string; created_at: string }
      | { district_id: string | null; property_type: string; created_at: string }[]
      | null;
    const prop = Array.isArray(propRaw) ? propRaw[0] : propRaw;
    if (!prop) continue; // portföysüz anlaşmada "listede kalma" süresi tanımsız
    const start = new Date(prop.created_at).getTime();
    const end = new Date(d.updated_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    wonSamples.push({
      districtId: prop.district_id,
      propertyType: prop.property_type,
      days: Math.round((end - start) / DAY_MS),
    });
  }

  type SpeedRow = {
    key: string;
    districtId: string | null;
    districtName: string;
    propertyType: string;
    medianDays: number;
    n: number;
  };
  const speedGroups = new Map<string, WonSample[]>();
  for (const s of wonSamples) {
    const key = `${s.districtId ?? "-"}|${s.propertyType}`;
    speedGroups.set(key, [...(speedGroups.get(key) ?? []), s]);
  }
  const speedRows: SpeedRow[] = [...speedGroups.entries()]
    .map(([key, list]) => ({
      key,
      districtId: list[0].districtId,
      districtName: list[0].districtId ?? "",
      propertyType: list[0].propertyType,
      medianDays: median(list.map((x) => x.days)) ?? 0,
      n: list.length,
    }))
    .sort((a, b) => b.n - a.n || a.medianDays - b.medianDays)
    .slice(0, 10);
  const officeMedianDays = median(wonSamples.map((s) => s.days));
  const lowSampleOverall = wonSamples.length > 0 && wonSamples.length < 5;

  // İlçe adları — D4 + D5'in ihtiyaç duyduğu tüm id'ler tek sorguda
  const districtIds = [
    ...new Set([
      ...yieldRows.map((r) => r.districtId),
      ...speedRows.map((r) => r.districtId).filter((x): x is string => Boolean(x)),
    ]),
  ];
  if (districtIds.length) {
    const { data: districts } = await supabase.from("geo_districts").select("id, name").in("id", districtIds);
    const names = new Map((districts ?? []).map((d) => [d.id, d.name as string]));
    for (const r of yieldRows) r.districtName = names.get(r.districtId) ?? "İlçe";
    for (const r of speedRows) r.districtName = r.districtId ? (names.get(r.districtId) ?? "İlçe") : "İlçesi girilmemiş";
  }
  yieldRows.sort((a, b) => b.grossYieldPct - a.grossYieldPct);

  const heroKpis = [
    { label: "Değerleme raporu", value: String(rows.length), icon: FileText, href: "#gecmis" },
    {
      label: "Ortalama güven",
      value: avgConfidence != null ? `%${avgConfidence}` : "—",
      icon: Gauge,
      href: "#gecmis",
    },
    {
      label: "Ofis brüt getiri",
      value: officeYield != null ? `%${nf1.format(officeYield)}` : "—",
      icon: BadgePercent,
      href: "#getiri",
    },
    {
      label: "Medyan satış süresi",
      value: officeMedianDays != null ? `${nf0.format(officeMedianDays)} gün` : "—",
      icon: Timer,
      href: "#sure",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-[80px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">
              <Gauge className="h-3.5 w-3.5" /> Çok kaynaklı değerleme
            </p>
            <h1 className="mt-2 font-display text-3xl font-extrabold">Değerleme motoru</h1>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              Ofis listesi + emsal m² + <strong className="text-white">Endeksa</strong> bölge endeksi +{" "}
              <strong className="text-white">Tapusor</strong> EDİ yapay zeka değerlemesi — insan onayı şart.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <DataPartnerStatus name="Endeksa" icon={Landmark} configured={endeksaOn} />
            <DataPartnerStatus name="Tapusor" icon={MapPinned} configured={tapusorOn} />
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {heroKpis.map((k) => (
            <a
              key={k.label}
              href={k.href}
              className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-white/30"
            >
              <k.icon className="h-4 w-4 text-cyan-400" />
              <p className="numeric mt-2 font-display text-xl font-extrabold text-white">{k.value}</p>
              <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
            </a>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <ValuationForm properties={properties ?? []} provinces={provinces ?? []} defaultPropertyId={preselectedPropertyId} />
        <section id="gecmis" className="scroll-mt-24 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Sparkles className="h-4 w-4 text-amber-500" /> Son değerlemeler
          </h2>
          {rows.length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
              Henüz değerleme yok. Soldan oluşturun.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {rows.map((v) => {
                const sources = (Array.isArray(v.sources) ? v.sources : []) as ValuationSource[];
                const priceSources = sources.filter((s) => s.weight > 0);
                const investmentScoreSource = sources.find((s) => s.name === "Tapusor yatırım puanı");
                return (
                  <article key={v.id} className="group relative rounded-[14px] border border-line bg-canvas/60 p-4 transition hover:border-brand-300">
                    {/* Kartın tamamı rapora gider; alttaki ikincil linkler z-10 ile üstte kalır */}
                    <Link
                      href={`/app/degerleme/${v.id}`}
                      className="absolute inset-0 rounded-[14px]"
                      aria-label={`${v.title ?? "Değerleme"} raporunu aç`}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display font-bold text-ink-950 group-hover:text-brand-600">{v.title}</p>
                      <span className="text-[11px] font-bold text-mint-600">
                        %{Math.round(Number(v.confidence || 0) * 100)} güven
                      </span>
                    </div>
                    <p className="mt-2 font-display text-xl font-extrabold text-brand-600">
                      {money(v.estimated_mid != null ? Number(v.estimated_mid) : null)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {money(v.estimated_low != null ? Number(v.estimated_low) : null)} –{" "}
                      {money(v.estimated_high != null ? Number(v.estimated_high) : null)}
                    </p>
                    {priceSources.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {priceSources.map((s) => (
                          <span
                            key={s.name}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              s.name.includes("Endeksa")
                                ? "bg-cyan-500/10 text-cyan-700"
                                : s.name.includes("Tapusor")
                                  ? "bg-brand-600/10 text-brand-600"
                                  : "bg-ink-950/6 text-text-muted"
                            }`}
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {investmentScoreSource ? (
                      <p className="mt-2 text-[11px] font-semibold text-brand-600">
                        Tapusor yatırım puanı: {investmentScoreSource.value}/100
                      </p>
                    ) : null}
                    {/* Rapor bagi eklendi: degerleme uretiliyordu ama musteriye
                        verilecek bir CIKTISI yoktu — sonuc yalnizca bu karttaki
                        birkac satirdi. */}
                    <div className="hairline-t mt-3 flex flex-wrap items-center gap-3 pt-2.5">
                      <Link
                        href={`/app/degerleme/${v.id}`}
                        className="focus-ring relative z-10 inline-flex items-center gap-1 rounded-[8px] text-xs font-bold text-brand-600 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> Raporu aç
                      </Link>
                      {v.property_id ? (
                        <Link
                          href={`/app/portfoyler/${v.property_id}`}
                          className="focus-ring relative z-10 text-xs font-semibold text-text-muted hover:text-brand-600 hover:underline"
                        >
                          Portföye git →
                        </Link>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* D4 — Kira çarpanı / getiri analizi                                  */}
      {/* ------------------------------------------------------------------ */}
      <section id="getiri" className="scroll-mt-24 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
              <PiggyBank className="h-4 w-4" /> Getiri analizi
            </p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink-950">Kira çarpanı ve brüt getiri</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-text-muted">
              Satış fiyatı ve kira verisi girilmiş portföylerden: ilçe medyan ₺/m² üzerinden brüt yıllık getiri ve
              amortisman yılı. Ofis medyanıyla kıyaslanır — dış endeks değildir.
            </p>
          </div>
          {officeYield != null && officeAmort != null ? (
            <div className="flex items-center gap-3 rounded-[14px] border border-mint-500/25 bg-mint-500/8 px-4 py-3">
              <TrendingUp className="h-5 w-5 text-mint-600" />
              <div>
                <p className="text-[11px] text-text-muted">Ofis geneli</p>
                <p className="numeric text-sm font-bold text-ink-950">
                  %{nf1.format(officeYield)} brüt · {nf1.format(officeAmort)} yıl amortisman
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {yieldRows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={PiggyBank}
              tone="mint"
              title="Getiri hesabı için veri eksik"
              description="Aynı ilçede hem satılık hem kiralık portföy (fiyat + m² girilmiş) biriktiğinde brüt getiri ve amortisman yılı burada hesaplanır."
              action={{ href: "/app/portfoyler", label: "Portföylere git" }}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
                  <th className="py-2.5 pr-3">İlçe</th>
                  <th className="py-2.5 pr-3 text-right">Satılık medyan ₺/m²</th>
                  <th className="py-2.5 pr-3 text-right">Kira medyan ₺/m²/ay</th>
                  <th className="py-2.5 pr-3 text-right">Brüt getiri</th>
                  <th className="py-2.5 pr-3 text-right">Amortisman</th>
                  <th className="py-2.5 pr-3 text-right">Örneklem</th>
                  <th className="py-2.5 text-right">Ofis medyanına göre</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {yieldRows.map((r) => {
                  const diff = districtYieldMedian != null ? r.grossYieldPct - districtYieldMedian : null;
                  return (
                    <tr key={r.districtId} className="group transition hover:bg-brand-600/[0.03]">
                      <td className="py-3 pr-3">
                        <Link
                          href={`/app/bolge-analizi?district=${r.districtId}`}
                          className="focus-ring font-semibold text-ink-950 underline-offset-2 transition hover:text-brand-600 hover:underline"
                        >
                          {r.districtName}
                        </Link>
                      </td>
                      <td className="numeric py-3 pr-3 text-right tabular-nums">{money(Math.round(r.saleMedian))}</td>
                      <td className="numeric py-3 pr-3 text-right tabular-nums">{money(Math.round(r.rentMedian))}</td>
                      <td className="numeric py-3 pr-3 text-right font-bold tabular-nums text-mint-600">
                        %{nf1.format(r.grossYieldPct)}
                      </td>
                      <td className="numeric py-3 pr-3 text-right tabular-nums">{nf1.format(r.amortYears)} yıl</td>
                      <td className="py-3 pr-3 text-right text-xs text-text-muted">
                        {r.sampleSale} satılık · {r.sampleRent} kiralık
                      </td>
                      <td className="py-3 text-right">
                        {diff == null ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              diff >= 0 ? "bg-mint-500/10 text-mint-600" : "bg-amber-400/15 text-amber-600"
                            }`}
                          >
                            {diff >= 0 ? "+" : "−"}
                            {nf1.format(Math.abs(diff))} puan
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {yieldRows.some((r) => r.sampleSale < 3 || r.sampleRent < 3) ? (
          <p className="mt-3 rounded-[12px] border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-xs text-amber-700">
            Bazı ilçelerde örneklem küçük (3 portföyün altı) — medyan tek bir kayıttan etkilenebilir, sonucu yön
            göstergesi olarak okuyun.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* D5 — Satış süresi tahmini                                           */}
      {/* ------------------------------------------------------------------ */}
      <section id="sure" className="scroll-mt-24 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
              <Hourglass className="h-4 w-4" /> Satış süresi tahmini
            </p>
            <h2 className="mt-1 font-display text-xl font-bold text-ink-950">İlçe / tip bazlı medyan kapanma süresi</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-text-muted">
              Kendi kazanılmış anlaşmalarınızdan: portföyün sisteme girişinden anlaşmanın kapanışına geçen gün sayısının
              medyanı. Yeni bir portföy için beklenen pazarlama süresini kestirir.
            </p>
          </div>
          {officeMedianDays != null ? (
            <Link
              href="/app/anlasmalar"
              className="focus-ring press flex items-center gap-3 rounded-[14px] border border-brand-600/20 bg-brand-600/6 px-4 py-3 transition hover:border-brand-400"
            >
              <Timer className="h-5 w-5 text-brand-600" />
              <div>
                <p className="text-[11px] text-text-muted">Ofis medyanı · {wonSamples.length} kapanış</p>
                <p className="numeric text-sm font-bold text-ink-950">{nf0.format(officeMedianDays)} gün</p>
              </div>
            </Link>
          ) : null}
        </div>

        {wonSamples.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={Hourglass}
              title="Henüz kapanmış anlaşma verisi yok"
              description="Anlaşmalar 'Kazanıldı' aşamasına taşındıkça satış süresi tahmini kendi verinizden burada oluşur."
              action={{ href: "/app/anlasmalar", label: "Anlaşmalara git" }}
            />
          </div>
        ) : (
          <>
            {lowSampleOverall ? (
              <p className="mt-4 rounded-[12px] border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-xs text-amber-700">
                Toplam {wonSamples.length} kapanış var — örneklem küçük olduğu için tahminler düşük güvenlidir. Kapanış
                sayısı arttıkça tahmin keskinleşir.
              </p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {speedRows.map((r) => {
                const conf = confidenceOf(r.n);
                return (
                  <Link
                    key={r.key}
                    href="/app/anlasmalar"
                    className="focus-ring press lift group block rounded-[14px] border border-line bg-canvas/60 p-4 transition hover:border-brand-300"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">
                          {r.districtName}
                        </p>
                        <p className="text-[11px] text-text-muted">{r.propertyType}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${conf.cls}`}>
                        {conf.label}
                      </span>
                    </div>
                    <p className="numeric mt-3 font-display text-2xl font-extrabold text-ink-950">
                      {nf0.format(r.medianDays)} gün
                    </p>
                    <p className="text-[11px] text-text-muted">medyan · {r.n} kapanış</p>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
