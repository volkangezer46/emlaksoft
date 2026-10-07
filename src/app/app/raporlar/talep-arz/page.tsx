import { KpiGrid } from "@/components/ui/dashboard-grid";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { ReportExportBar } from "@/components/app/report-export-bar";
import { ButtonLink } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SkeletonCard } from "@/components/ui/viz";
import { shareOfMax } from "../report-math";
import { getDistrictNameMap, getProvinces } from "@/lib/geo/reader";
import Link from "@/components/ui/smart-link";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  BarChart3,
  Building2,
  Flame,
  Map as MapIcon,
  Scale,
  Target,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { daysAgoIso } from "@/lib/clock";
import { compareTr } from "@/lib/tr-text";
import {
  aggregateTalepArz,
  coverageTone,
  gapKind,
  median,
  rollupByProvince,
  type TalepArzDemandRow,
  type TalepArzPropertyRow,
} from "@/lib/talep-arz";
import type { TalepArzMarker } from "./talep-arz-map";

// Harita ağır bir client komponenti — dynamic import ile ayrı chunk
// (portfoyler sayfasındaki MapView deseniyle aynı).
const TalepArzMap = dynamic(() => import("./talep-arz-map").then((m) => m.TalepArzMap), {
  loading: () => <SkeletonCard height={460} label="Harita yükleniyor" />,
});

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

/** ?islem= kontratı — DB'deki transaction_type değerleri Türkçe ("Satılık"/"Kiralık"). */
const ISLEM_FILTERS = [
  { key: "", label: "Tümü", db: null },
  { key: "satilik", label: "Satılık", db: "Satılık" },
  { key: "kiralik", label: "Kiralık", db: "Kiralık" },
] as const;

/** ?donem= kontratı — talep penceresi gün sayısı. */
const DONEM_FILTERS = [
  { key: "30", days: 30, label: "Son 30 gün" },
  { key: "90", days: 90, label: "Son 90 gün" },
  { key: "365", days: 365, label: "Son 365 gün" },
] as const;
const DEFAULT_DONEM = "90";

/** Açık sayılan talep durumları (talepler sayfasının varsayılan filtresiyle aynı küme). */
const OPEN_DEMAND_STATUSES = ["new", "active", "matched"];
/** Yayında sayılan portföy durumları (portfoyler status=live filtresiyle uyumlu). */
const LIVE_PROPERTY_STATUSES = ["live", "Yayında"];

const GAP_BADGE = {
  collect: { label: "Fırsat: portföy topla", cls: "bg-mint-500/12 text-[color:var(--viz-pos)]" },
  generate: { label: "Talep üret", cls: "bg-amber-400/15 text-amber-600" },
  balanced: { label: "Dengede", cls: "bg-canvas text-text-muted" },
} as const;

const TONE_TEXT = { mint: "text-[color:var(--viz-pos)]", amber: "text-amber-600", red: "text-danger-500" } as const;

export default async function TalepArzPage({
  searchParams,
}: {
  searchParams: Promise<{ islem?: string; il?: string; donem?: string }>;
}) {
  await requireModulePage("reports", "/app/raporlar");
  const sp = await searchParams;
  const supabase = await createClient();

  const islem = ISLEM_FILTERS.find((f) => f.key === (sp.islem ?? "")) ?? ISLEM_FILTERS[0];
  const donem = DONEM_FILTERS.find((f) => f.key === (sp.donem ?? DEFAULT_DONEM)) ?? DONEM_FILTERS[1];
  const ilFilter = (sp.il ?? "").trim() || null;
  const windowIso = daysAgoIso(donem.days);

  // Talepler: dönem penceresinde AÇILAN açık talepler. Portföyler: şu an
  // yayında olan stok (stoka pencere uygulamak arzı yapay düşürür — dürüst
  // kıyas "güncel arz vs dönem içi talep akışı"dır, başlık altında belirtilir).
  let demandQuery = supabase
    .from("customer_demands")
    .select("province_id, district_id, budget_min, budget_max")
    .in("status", OPEN_DEMAND_STATUSES)
    .gte("created_at", windowIso)
    .limit(2000);
  let propertyQuery = supabase
    .from("properties")
    .select("province_id, district_id, list_price")
    .is("deleted_at", null)
    .in("status", LIVE_PROPERTY_STATUSES)
    .limit(2000);
  if (islem.db) {
    demandQuery = demandQuery.eq("transaction_type", islem.db);
    propertyQuery = propertyQuery.eq("transaction_type", islem.db);
  }
  if (ilFilter) {
    demandQuery = demandQuery.eq("province_id", ilFilter);
    propertyQuery = propertyQuery.eq("province_id", ilFilter);
  }

  const [{ data: demandData }, { data: propertyData }, { data: provinceData }] = await Promise.all([
    demandQuery,
    propertyQuery,
    // İl referansı: filtre dropdown'ı + harita daire koordinatları tek sorgudan
    getProvinces().then((list) => ({ data: list.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })) })),
  ]);

  const demands = (demandData ?? []) as TalepArzDemandRow[];
  const properties = (propertyData ?? []) as TalepArzPropertyRow[];
  const provinces = [...(provinceData ?? [])].sort((a, b) => compareTr(a.name, b.name)) as {
    id: string;
    name: string;
    lat: number | null;
    lng: number | null;
  }[];
  const provinceById = new Map(provinces.map((p) => [p.id, p]));
  const selectedProvince = ilFilter ? (provinceById.get(ilFilter) ?? null) : null;

  // İlçe adları — yalnız veride geçen id'ler çekilir (973 satırın tamamı değil)
  const aggMap = aggregateTalepArz(demands, properties);
  const districtIds = [...new Set([...aggMap.values()].map((a) => a.districtId).filter((x): x is string => Boolean(x)))];
  const districtById = new Map<string, string>();
  if (districtIds.length > 0) {
    for (const [id, name] of await getDistrictNameMap(districtIds)) districtById.set(id, name);
  }

  // Tablo satırları — bölge etiketi + metrikler; talep, sonra arz sırasıyla
  const rows = [...aggMap.values()]
    .map((agg) => {
      const provinceName = provinceById.get(agg.provinceId)?.name ?? "Bilinmeyen il";
      const districtName = agg.districtId ? (districtById.get(agg.districtId) ?? "Bilinmeyen ilçe") : null;
      const tone = coverageTone(agg.demandCount, agg.supplyCount);
      return {
        key: `${agg.provinceId}|${agg.districtId ?? ""}`,
        provinceId: agg.provinceId,
        provinceName,
        districtName,
        label: districtName ?? "(İlçe belirtilmedi)",
        demandCount: agg.demandCount,
        supplyCount: agg.supplyCount,
        ratio: agg.demandCount > 0 ? agg.supplyCount / agg.demandCount : null,
        medianBudget: median(agg.budgets),
        medianPrice: median(agg.prices),
        gap: gapKind(agg.demandCount, agg.supplyCount),
        tone,
        // Portföy hedefi: portfoyler ?q= sunucuda il/ilçe adlarını da tarar
        supplyHref: `/app/portfoyler?q=${encodeURIComponent(districtName ?? provinceName)}&status=live`,
        // Talepler sayfası il/ilçe paramı okumuyor — mevcut kontrata uyulur
        // (yalnız ?status= okunuyor; varsayılan görünüm zaten açık talepler).
        demandHref: "/app/talepler",
        unmetBudget: agg.supplyCount === 0 ? agg.budgets.reduce((s, b) => s + b, 0) : 0,
      };
    })
    .sort((a, b) => b.demandCount - a.demandCount || b.supplyCount - a.supplyCount || compareTr(a.label, b.label));

  const totalDemand = demands.length;
  const totalSupply = properties.length;
  // En aç ilçe: talep/arz oranı en yüksek (arz 0 ise oran = talep sayısı ile sırala)
  const hungriest = rows
    .filter((r) => r.demandCount > 0)
    .sort((a, b) => b.demandCount / Math.max(1, b.supplyCount) - a.demandCount / Math.max(1, a.supplyCount) || b.demandCount - a.demandCount)[0] ?? null;
  // Karşılanamayan bütçe: hiç yayında portföyü olmayan bölgelerdeki talep bütçeleri
  const unmetBudgetTotal = rows.reduce((s, r) => s + r.unmetBudget, 0);

  // Harita marker'ları — il merkezleri (geo_provinces lat/lng dolu; geo_districts değil)
  const provinceRollup = rollupByProvince(aggMap.values());
  const markers: TalepArzMarker[] = [...provinceRollup.entries()]
    .map(([provinceId, agg]) => {
      const prov = provinceById.get(provinceId);
      if (!prov || typeof prov.lat !== "number" || typeof prov.lng !== "number") return null;
      return {
        id: provinceId,
        name: prov.name,
        lat: prov.lat,
        lng: prov.lng,
        demand: agg.demandCount,
        supply: agg.supplyCount,
        tone: coverageTone(agg.demandCount, agg.supplyCount),
        href: talepArzHref({ il: provinceId }),
      };
    })
    .filter((m): m is TalepArzMarker => m !== null);

  // Bar grafik: en çok talep gören 12 ilçe — talep (marka) vs arz (mint) çift bar
  const barRows = rows.filter((r) => r.demandCount > 0 || r.supplyCount > 0).slice(0, 12);
  const barMax = Math.max(1, ...barRows.map((r) => Math.max(r.demandCount, r.supplyCount)));

  /** Mevcut filtre bağlamını koruyarak rapor linki üretir. */
  function talepArzHref(patch: { islem?: string; il?: string | null; donem?: string }) {
    const q = new URLSearchParams();
    const nextIslem = patch.islem !== undefined ? patch.islem : islem.key;
    const nextIl = patch.il !== undefined ? patch.il : ilFilter;
    const nextDonem = patch.donem !== undefined ? patch.donem : donem.key;
    if (nextIslem) q.set("islem", nextIslem);
    if (nextIl) q.set("il", nextIl);
    if (nextDonem && nextDonem !== DEFAULT_DONEM) q.set("donem", nextDonem);
    const s = q.toString();
    return s ? `/app/raporlar/talep-arz?${s}` : "/app/raporlar/talep-arz";
  }

  const ratioText = (r: number | null) =>
    r === null ? "—" : r.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapor merkezi"
        title="Talep-Arz Haritası"
        description={`${donem.label.toLowerCase()}de açılan açık talepler ile şu an yayındaki portföy stoku ilçe kırılımında karşılaştırılır — nerede portföy toplamalı, nerede talep üretmeli.`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <ReportExportBar
              rows={rows.map((r) => ({
                il: r.provinceName,
                ilce: r.districtName ?? "(belirtilmedi)",
                talep: r.demandCount,
                arz: r.supplyCount,
                arz_talep_orani: r.ratio === null ? null : Math.round(r.ratio * 10) / 10,
                medyan_butce: r.medianBudget,
                medyan_fiyat: r.medianPrice,
              }))}
              filename={`talep-arz-${islem.key || "tumu"}-${donem.key}.csv`}
            />
            <ButtonLink href="/app/raporlar" variant="secondary" icon={BarChart3}>Rapor merkezi</ButtonLink>
          </span>
        }
      />

      {/* Filtreler — işlem türü + dönem pill'leri, il seçimi form (JS'siz GET) */}
      <div className="flex flex-wrap items-center gap-2">
        {ISLEM_FILTERS.map((f) => {
          const active = islem.key === f.key;
          return (
            <Link
              key={f.key || "tumu"}
              href={talepArzHref({ islem: f.key })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-accent text-white"
                  : "border border-line bg-surface text-text-muted hover:border-border-interactive hover:text-accent-text"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
        {DONEM_FILTERS.map((f) => {
          const active = donem.key === f.key;
          return (
            <Link
              key={f.key}
              href={talepArzHref({ donem: f.key })}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-accent text-accent-fg"
                  : "border border-line bg-surface text-text-muted hover:border-border-interactive hover:text-accent-text"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
        <form action="/app/raporlar/talep-arz" className="ml-auto flex items-center gap-2">
          {islem.key ? <input type="hidden" name="islem" value={islem.key} /> : null}
          {donem.key !== DEFAULT_DONEM ? <input type="hidden" name="donem" value={donem.key} /> : null}
          <select
            name="il"
            defaultValue={ilFilter ?? ""}
            aria-label="İl filtresi"
            className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text outline-none transition focus:border-accent"
          >
            <option value="">Tüm iller</option>
            {provinces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-[var(--radius-control)] bg-ink-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-ink-800"
          >
            Uygula
          </button>
          {selectedProvince ? (
            <Link
              href={talepArzHref({ il: null })}
              className="text-xs font-semibold text-accent-text hover:underline"
              title="İl filtresini kaldır"
            >
              {selectedProvince.name} ✕
            </Link>
          ) : null}
        </form>
      </div>

      <KpiGrid>
        <StatCard
          label={`Açık talep · ${donem.label.toLowerCase()}`}
          value={totalDemand}
          icon={Target}
          href="/app/talepler"
        />
        <StatCard
          label="Yayındaki portföy"
          value={totalSupply}
          icon={Building2}
          tone="success"
          href="/app/portfoyler?status=live"
        />
        <StatCard
          label="En aç ilçe (talep/arz)"
          value={hungriest ? hungriest.label : "—"}
          icon={Flame}
          tone="warning"
          trend={hungriest ? "neutral" : undefined}
          trendLabel={hungriest ? `${hungriest.demandCount} talep / ${hungriest.supplyCount} portföy` : undefined}
          href={hungriest ? hungriest.supplyHref : "/app/talepler"}
        />
        <StatCard
          label="Karşılanamayan bütçe (arzsız bölgeler)"
          value={unmetBudgetTotal > 0 ? money(unmetBudgetTotal) : "0 ₺"}
          icon={Wallet}
          tone={unmetBudgetTotal > 0 ? "danger" : "neutral"}
          href="/app/talepler"
        />
      </KpiGrid>

      {totalDemand === 0 ? (
        <EmptyState illustration="rapor"
          icon={Target}
          title={ilFilter || islem.key ? "Bu filtrede açık talep yok" : "Henüz açık talep yok"}
          description={
            ilFilter || islem.key
              ? "Filtreyi genişletin ya da dönem penceresini büyütün. Talep girildikçe bölge dengesi burada oluşur."
              : "Müşteri talepleri girildikçe ilçe bazlı talep-arz dengesi burada oluşur. İlk talebi talep merkezinden ekleyebilirsiniz."
          }
          action={{ href: "/app/talepler", label: "Talep merkezine git" }}
        />
      ) : (
        <>
          {/* İlçe bazlı denge tablosu */}
          <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
            <div className="flex flex-wrap items-center gap-2">
              <Scale className="h-4 w-4 text-accent-text" />
              <h2 className="font-display font-bold text-text">İlçe bazlı talep-arz dengesi</h2>
              <span className="ml-auto text-xs text-text-muted">
                {rows.length} bölge · talep {donem.label.toLowerCase()} · arz güncel stok
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <Table className="w-full min-w-[760px] text-sm">
                <THead>
                  <TR className="border-b border-line text-left text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                    <TH className="py-2 pr-3">İlçe</TH>
                    <TH className="py-2 pr-3 text-right">Açık talep</TH>
                    <TH className="py-2 pr-3 text-right">Yayında portföy</TH>
                    <TH className="py-2 pr-3 text-right">Arz/Talep</TH>
                    <TH className="py-2 pr-3 text-right">Medyan bütçe</TH>
                    <TH className="py-2 pr-3 text-right">Medyan liste fiyatı</TH>
                    <TH className="py-2 text-right">Boşluk</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.length === 0 ? (
                    // Talep var ama hiçbirinde il bilgisi yok — başlık şeridi boş
                    // gövdeyle asılı kalmasın (görsel QA bulgusu, Dalga M).
                    <TR>
                      <TD colSpan={7} className="py-8 text-center text-sm text-text-muted">
                        Bölge bilgisi (il/ilçe) girilmiş talep yok — talep kartlarına konum ekledikçe
                        denge tablosu burada oluşur.
                      </TD>
                    </TR>
                  ) : null}
                  {rows.map((r) => {
                    const badge = GAP_BADGE[r.gap];
                    return (
                      <TR key={r.key} className="border-b border-line/60 transition hover:bg-canvas">
                        <TD className="py-2.5 pr-3">
                          <p className="font-semibold text-text">{r.label}</p>
                          <p className="text-xs text-text-muted">{r.provinceName}</p>
                        </TD>
                        <TD className="py-2.5 pr-3 text-right">
                          <Link
                            href={r.demandHref}
                            className="focus-ring group inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-0.5 font-display font-extrabold tabular-nums text-accent-text hover:bg-accent-subtle"
                            title="Açık talepler (talep merkezi)"
                          >
                            {r.demandCount}
                            <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-accent-text group-hover:opacity-100" />
                          </Link>
                        </TD>
                        <TD className="py-2.5 pr-3 text-right">
                          <Link
                            href={r.supplyHref}
                            className="focus-ring group inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-0.5 font-display font-extrabold tabular-nums text-[color:var(--viz-pos)] hover:bg-mint-500/10"
                            title={`Yayındaki portföyler — ${r.districtName ?? r.provinceName}`}
                          >
                            {r.supplyCount}
                            <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-[color:var(--viz-pos)] group-hover:opacity-100" />
                          </Link>
                        </TD>
                        <TD className={`py-2.5 pr-3 text-right font-semibold tabular-nums ${TONE_TEXT[r.tone]}`}>
                          {ratioText(r.ratio)}
                        </TD>
                        <TD className="py-2.5 pr-3 text-right tabular-nums text-text-muted">
                          {r.medianBudget !== null ? money(r.medianBudget) : "—"}
                        </TD>
                        <TD className="py-2.5 pr-3 text-right tabular-nums text-text-muted">
                          {r.medianPrice !== null ? money(r.medianPrice) : "—"}
                        </TD>
                        <TD className="py-2.5 text-right">
                          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          </section>

          {/* İlçe çift bar grafiği — geo_districts'te koordinat olmadığından ilçe
              haritası yerine bar görünümü (il haritası aşağıda ayrıca var) */}
          {barRows.length > 0 ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <div className="flex flex-wrap items-center gap-2">
                <BarChart3 className="h-4 w-4 text-accent-text" />
                <h2 className="font-display font-bold text-text">Talep vs arz · ilçe sıralaması</h2>
                <span className="ml-auto flex items-center gap-4 text-xs text-text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" /> Talep
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-mint-500" /> Arz
                  </span>
                </span>
              </div>
              <div className="mt-5 space-y-3">
                {barRows.map((r) => (
                  <Link key={r.key} href={r.supplyHref} className="focus-ring group block rounded-[var(--radius-control)] p-1 -m-1">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 font-semibold text-text">
                        {r.label}
                        <span className="font-normal text-text-faint">· {r.provinceName}</span>
                        <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-accent-text group-hover:opacity-100" />
                      </span>
                      <span className="tabular-nums text-text-muted">
                        {r.demandCount} talep · {r.supplyCount} arz
                      </span>
                    </div>
                    <div className="space-y-1">
                      <Progress value={shareOfMax(r.demandCount, barMax, 4)} label={`${r.label} talep`} />
                      <Progress value={shareOfMax(r.supplyCount, barMax, 4)} label={`${r.label} arz`} tone="success" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {/* İl haritası — il merkezlerinde daire (boyut=talep, renk=denge).
              İlçe merkezi koordinatları geo_districts'te tanımlı değil; bu
              yüzden daireler il seviyesinde, ilçe kırılımı yukarıdaki tablo
              ve bar grafikte. */}
          {markers.length > 0 ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <MapIcon className="h-4 w-4 text-accent-text" />
                <h2 className="font-display font-bold text-text">Denge haritası · il görünümü</h2>
                <span className="ml-auto text-xs text-text-muted">
                  Daireye tıklayın → o ilin ilçe dökümü açılır
                </span>
              </div>
              <TalepArzMap markers={markers} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
