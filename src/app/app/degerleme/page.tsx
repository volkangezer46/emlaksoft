import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import Link from "next/link";
import { ReferralNudge } from "@/components/app/referral-nudge";
import {
  BadgePercent,
  FileText,
  Gauge,
  Hourglass,
  Landmark,
  PiggyBank,
  Sparkles,
  Timer,
  TrendingUp,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { isEmlakFiyatiConfigured } from "@/lib/integrations/emlakfiyati/client";
import { DAY_MS } from "@/lib/clock";
import { ValuationForm } from "./valuation-form";
import { DegerlemeTabs } from "./degerleme-tabs";
import { getEfFeatureState } from "@/lib/ef-credits/service";
import { DataPartnerStatus } from "@/components/app/data-partner-badges";
import { EmptyState } from "@/components/app/empty-state";
import { getDefinitionsOrDefault } from "@/lib/definitions";

import { PageHeader } from "@/components/ui/page-header";
import { getDistrictNameMap, provinceOptionsResult } from "@/lib/geo/reader";
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
  const { tenantId: gateTenantId } = await requireModulePage("valuation", "/app/degerleme");
  // Ada/Parsel sekmesi yalnız servis hazırsa görünür (hazır değilken ofis kullanıcısına çıkmaz sayfa gösterilmez).
  const parselReady = gateTenantId ? (await getEfFeatureState(gateTenantId)).ready : false;
  const { property: preselectedPropertyId } = await searchParams;
  const supabase = await createClient();
  const [
    { data: valuations },
    { data: properties },
    { data: provinces },
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
    provinceOptionsResult(),
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
      .select("id, deal_type, created_at, updated_at, property:properties!deals_property_id_fkey(district_id, property_type, created_at)")
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
    const names = await getDistrictNameMap(districtIds);
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
      <PageHeader title="Değerleme motoru" eyebrow="Çok kaynaklı değerleme" description="Ofis listesi + emsal m² + EmlakFiyati bölge endeksi — insan onayı şart." actions={
<div className="theme-dark flex flex-col gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2">
            <DataPartnerStatus name="EmlakFiyati" icon={Landmark} configured={await isEmlakFiyatiConfigured()} />
          </div>
} />
      <DegerlemeTabs active="motor" parselReady={parselReady} />
      <ReferralNudge moment="first_valuation" show={rows.length >= 1} />
<section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-[80px]" />
        
        <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {heroKpis.map((k) => (
            <a
              key={k.label}
              href={k.href}
              className="focus-ring press lift group block rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-white/30"
            >
              <k.icon className="h-4 w-4 text-cyan-400" />
              <p className="numeric mt-2 font-display text-xl font-extrabold text-white">{k.value}</p>
              <p className="text-xs text-white/45 sm:text-xs">{k.label}</p>
            </a>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <ValuationForm properties={properties ?? []} provinces={provinces ?? []} defaultPropertyId={preselectedPropertyId} propertyTypes={(await getDefinitionsOrDefault("property_type")).map((d) => d.value)} />
        <section id="gecmis" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Sparkles className="h-4 w-4 text-amber-500" /> Son değerlemeler
          </h2>
          {rows.length === 0 ? (
            <p className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
              Henüz değerleme yok. Soldan oluşturun.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {rows.map((v) => {
                const sources = (Array.isArray(v.sources) ? v.sources : []) as ValuationSource[];
                const priceSources = sources.filter((s) => s.weight > 0);
                return (
                  <article key={v.id} className="group relative rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 transition hover:border-brand-300">
                    {/* Kartın tamamı rapora gider; alttaki ikincil linkler z-10 ile üstte kalır */}
                    <Link
                      href={`/app/degerleme/${v.id}`}
                      className="absolute inset-0 rounded-[var(--radius-card)]"
                      aria-label={`${v.title ?? "Değerleme"} raporunu aç`}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-display font-bold text-ink-950 group-hover:text-brand-600">{v.title}</p>
                      <span className="text-xs font-bold text-mint-600">
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
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              s.name.includes("EmlakFiyati")
                                ? "bg-cyan-500/10 text-cyan-700"
                                : "bg-ink-950/6 text-text-muted"
                            }`}
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {/* Rapor bagi eklendi: degerleme uretiliyordu ama musteriye
                        verilecek bir CIKTISI yoktu — sonuc yalnizca bu karttaki
                        birkac satirdi. */}
                    <div className="hairline-t mt-3 flex flex-wrap items-center gap-3 pt-2.5">
                      <Link
                        href={`/app/degerleme/${v.id}`}
                        className="focus-ring relative z-10 inline-flex items-center gap-1 rounded-[var(--radius-control)] text-xs font-bold text-brand-600 hover:underline"
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
      <section id="getiri" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
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
            <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-mint-500/25 bg-mint-500/8 px-4 py-3">
              <TrendingUp className="h-5 w-5 text-mint-600" />
              <div>
                <p className="text-xs text-text-muted">Ofis geneli</p>
                <p className="numeric text-sm font-bold text-ink-950">
                  %{nf1.format(officeYield)} brüt · {nf1.format(officeAmort)} yıl amortisman
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {yieldRows.length === 0 ? (
          <div className="mt-4">
            <EmptyState illustration="rapor"
              icon={PiggyBank}
              tone="mint"
              title="Getiri hesabı için veri eksik"
              description="Aynı ilçede hem satılık hem kiralık portföy (fiyat + m² girilmiş) biriktiğinde brüt getiri ve amortisman yılı burada hesaplanır."
              action={{ href: "/app/portfoyler", label: "Portföylere git" }}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table className="w-full min-w-[720px] text-sm">
              <THead>
                <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-faint">
                  <TH className="py-2.5 pr-3">İlçe</TH>
                  <TH className="py-2.5 pr-3 text-right">Satılık medyan ₺/m²</TH>
                  <TH className="py-2.5 pr-3 text-right">Kira medyan ₺/m²/ay</TH>
                  <TH className="py-2.5 pr-3 text-right">Brüt getiri</TH>
                  <TH className="py-2.5 pr-3 text-right">Amortisman</TH>
                  <TH className="py-2.5 pr-3 text-right">Örneklem</TH>
                  <TH className="py-2.5 text-right">Ofis medyanına göre</TH>
                </TR>
              </THead>
              <TBody className="divide-y divide-line">
                {yieldRows.map((r) => {
                  const diff = districtYieldMedian != null ? r.grossYieldPct - districtYieldMedian : null;
                  return (
                    <TR key={r.districtId} className="group transition hover:bg-brand-600/[0.03]">
                      <TD className="py-3 pr-3">
                        <Link
                          href={`/app/bolge-analizi?district=${r.districtId}`}
                          className="focus-ring font-semibold text-ink-950 underline-offset-2 transition hover:text-brand-600 hover:underline"
                        >
                          {r.districtName}
                        </Link>
                      </TD>
                      <TD className="numeric py-3 pr-3 text-right tabular-nums">{money(Math.round(r.saleMedian))}</TD>
                      <TD className="numeric py-3 pr-3 text-right tabular-nums">{money(Math.round(r.rentMedian))}</TD>
                      <TD className="numeric py-3 pr-3 text-right font-bold tabular-nums text-mint-600">
                        %{nf1.format(r.grossYieldPct)}
                      </TD>
                      <TD className="numeric py-3 pr-3 text-right tabular-nums">{nf1.format(r.amortYears)} yıl</TD>
                      <TD className="py-3 pr-3 text-right text-xs text-text-muted">
                        {r.sampleSale} satılık · {r.sampleRent} kiralık
                      </TD>
                      <TD className="py-3 text-right">
                        {diff == null ? (
                          <span className="text-text-faint">—</span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              diff >= 0 ? "bg-mint-500/10 text-mint-600" : "bg-amber-400/15 text-amber-600"
                            }`}
                          >
                            {diff >= 0 ? "+" : "−"}
                            {nf1.format(Math.abs(diff))} puan
                          </span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
        {yieldRows.some((r) => r.sampleSale < 3 || r.sampleRent < 3) ? (
          <p className="mt-3 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-xs text-amber-700">
            Bazı ilçelerde örneklem küçük (3 portföyün altı) — medyan tek bir kayıttan etkilenebilir, sonucu yön
            göstergesi olarak okuyun.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* D5 — Satış süresi tahmini                                           */}
      {/* ------------------------------------------------------------------ */}
      <section id="sure" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
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
              className="focus-ring press flex items-center gap-3 rounded-[var(--radius-card)] border border-brand-600/20 bg-brand-600/6 px-4 py-3 transition hover:border-brand-400"
            >
              <Timer className="h-5 w-5 text-brand-600" />
              <div>
                <p className="text-xs text-text-muted">Ofis medyanı · {wonSamples.length} kapanış</p>
                <p className="numeric text-sm font-bold text-ink-950">{nf0.format(officeMedianDays)} gün</p>
              </div>
            </Link>
          ) : null}
        </div>

        {wonSamples.length === 0 ? (
          <div className="mt-4">
            <EmptyState illustration="rapor"
              icon={Hourglass}
              title="Henüz kapanmış anlaşma verisi yok"
              description="Anlaşmalar 'Kazanıldı' aşamasına taşındıkça satış süresi tahmini kendi verinizden burada oluşur."
              action={{ href: "/app/anlasmalar", label: "Anlaşmalara git" }}
            />
          </div>
        ) : (
          <>
            {lowSampleOverall ? (
              <p className="mt-4 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/8 px-3 py-2 text-xs text-amber-700">
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
                    className="focus-ring press lift group block rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4 transition hover:border-brand-300"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">
                          {r.districtName}
                        </p>
                        <p className="text-xs text-text-muted">{r.propertyType}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${conf.cls}`}>
                        {conf.label}
                      </span>
                    </div>
                    <p className="numeric mt-3 font-display text-2xl font-extrabold text-ink-950">
                      {nf0.format(r.medianDays)} gün
                    </p>
                    <p className="text-xs text-text-muted">medyan · {r.n} kapanış</p>
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
