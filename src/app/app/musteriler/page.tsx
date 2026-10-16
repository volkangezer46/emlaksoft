import { ActionSegmentList } from "./_segments/action-segment";
import { ACTION_SEGMENTS, ACTION_SEGMENT_KEYS, parseActionSegment, type ActionSegment } from "./_segments/keys";
import { getInvisibleFeatures } from "@/lib/modules/prefs";
import { Suspense } from "react";
import { measure } from "@/lib/server-timing";
import { SkeletonCard } from "@/components/ui/viz";
import Link from "@/components/ui/smart-link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ColumnChartCard, ListPage } from "@/components/ui/list-page";
import { HelpTip } from "@/components/ui/help-tip";
import {
  ArrowDown,
  ArrowUp,
  Cake,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Upload,
  Flame,
  Gift,
  Moon,
  PhoneCall,
  Plus,
  Search,
  Snowflake,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { formatLeadSource } from "@/lib/lead-sources";
import { HEAT_POOL_LIMIT, normalizeCustomerFilters } from "@/lib/customer-list-filters";
import { LEAD_CHANNEL_OPTIONS, leadChannelLabel } from "@/lib/lead-channel";
import { SavedViews } from "@/components/app/saved-views-lazy";
import { CustomerBulkBar, CustomerBulkProvider } from "./customer-bulk-actions";
import { HEAT_SEGMENTS, type HeatSegment } from "@/lib/customer-state/heat";
import { EmptyState } from "@/components/ui/empty-state";
import { ICONS } from "@/lib/icons";
import {
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListToolbar,
  PILL_TONE_CLASS,
  StatusPill,
  buildActiveChips,
  densityOf,
  type KpiItem,
} from "@/components/ui/list-kit";
import { CustomerPortalPanel } from "./customer-portal-panel";
import { CustomerTable } from "./customer-rows";
import { heatTone } from "./customer-list-logic";
import { HEAT_SEGMENT_KEYS, PAGE_SIZE, WINDOW_DAYS, loadCustomersData, type CustomersSummary } from "./data";
import { getListScope } from "@/lib/access-control";
import { ScopeBadge } from "@/components/app/scope-badge";
import { createClient } from "@/lib/supabase/server";
import { customFilterRaw, customFilterValue, resolveCustomFieldFilter } from "@/lib/custom-fields/filter";
import { CustomFieldFilterBar } from "@/components/app/custom-field-filter-bar";
import { getUiPrefs } from "@/lib/ui-prefs-server";

export const metadata = { title: "Müşteriler" };

/** Sütun başlığı sıralama linki — modül seviyesinde (render içinde komponent üretme kuralı). */
function SortHeaderLink({
  href,
  active,
  dir,
  label,
}: {
  href: string;
  active: boolean;
  dir: "asc" | "desc";
  label: string;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Link
      href={href}
      className={`focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-0.5 uppercase tracking-[0.04em] transition hover:text-ink-950 touch:min-h-11 ${active ? "text-brand-700" : ""}`}
    >
      {label}
      <Icon className={`h-3.5 w-3.5 ${active ? "text-brand-600" : "text-text-faint"}`} />
    </Link>
  );
}

function occasionLabel(days: number): string {
  if (days === 0) return "bugün";
  if (days === 1) return "yarın";
  return `${days} gün sonra`;
}

const PAGER_BTN =
  "focus-ring press inline-flex touch:min-h-11 items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex touch:min-h-11 items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

type BaseParams = Record<string, string>;
type CustomerTypeDefs = Awaited<ReturnType<typeof loadCustomersData>>["customerTypes"];

/** Filtre parametreleri korunarak liste adresi kurar (sayfa ve akış bileşenleri ortak). */
function customersHref(baseParams: BaseParams, overrides: Record<string, string | undefined>) {
  const merged: Record<string, string | undefined> = { ...baseParams, ...overrides };
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) if (value) usp.set(key, value);
  const qs = usp.toString();
  return qs ? `/app/musteriler?${qs}` : "/app/musteriler";
}

const SEGMENT_CARDS = [
  { key: "sicak" as const, icon: Flame },
  { key: "ilgili" as const, icon: Sparkles },
  { key: "soguk" as const, icon: Snowflake },
  { key: "uykuda" as const, icon: Moon },
];

/** KPI şeridi — hepsi tıklanabilir; çubuk/trend yalnız gerçek haftalık kayıt serisinden. Liste beklemeden akar. */
async function KpisStream({ summary, totalAll, baseParams }: { summary: Promise<CustomersSummary>; totalAll: number; baseParams: BaseParams }) {
  const s = await summary;
  const kpis: KpiItem[] = [
    { label: "Toplam kayıt", value: totalAll, icon: <ICONS.musteri />, tone: "info", href: "/app/musteriler", hint: "kayıtlı müşteri" },
    {
      label: "Aktif alıcı",
      value: s.buyerCount,
      icon: <UserCheck />,
      tone: "success",
      href: `/app/musteriler?type=${encodeURIComponent("Alıcı")}`,
      hint: "alıcı tipinde",
    },
    {
      label: "Mülk sahibi",
      value: s.ownerCount,
      icon: <ICONS.portfoy />,
      tone: "neutral",
      href: `/app/musteriler?type=${encodeURIComponent("Mülk sahibi")}`,
      hint: "portföy kaynağı",
    },
    {
      label: "Yeni · son 8 hafta",
      value: s.growthTotal,
      icon: <TrendingUp />,
      tone: "info",
      href: `/app/musteriler?from=${s.growthFromDate}`,
      series: s.weeklySeries,
      showTrend: true,
      seriesLabel: "önceki 4 haftaya göre",
      hint: s.growthTotal === 0 ? "yeni müşteri eklenmedi" : undefined,
    },
    {
      label: "Sıcak müşteri",
      value: s.segmentCounts.sicak,
      icon: <Flame />,
      tone: "warning",
      href: customersHref(baseParams, { segment: "sicak", sayfa: undefined }),
      hint: s.poolLimited ? `yaklaşık (ilk ${HEAT_POOL_LIMIT.toLocaleString("tr-TR")} kayıt)` : "şu an en canlı",
    },
  ];
  return <KpiStrip items={kpis} />;
}

/** Grafikler: yalnız güvenilir sayım varsa (tarama kesilmediyse); her sütun filtreli listeye gider. */
async function ChartsStream({ summary, customerTypes }: { summary: Promise<CustomersSummary>; customerTypes: CustomerTypeDefs }) {
  const { typeCounts, weeklyBars, growthFromDate } = await summary;
  const typeBars = typeCounts
    ? customerTypes.map((t) => ({
        label: t.label,
        value: typeCounts[t.value] ?? 0,
        href: `/app/musteriler?type=${encodeURIComponent(t.value)}`,
      }))
    : [];
  return (
    <>
      <ColumnChartCard
        title="Müşteri tipleri"
        subtitle="Bir müşteri birden çok tipte olabilir"
        icon={ICONS.musteri}
        bars={typeBars}
        href="/app/musteriler"
      />
      {weeklyBars ? (
        <ColumnChartCard
          title="Yeni müşteri"
          subtitle="Son 8 hafta · haftalık kayıt"
          icon={TrendingUp}
          tone="success"
          barTone="success"
          highlight={weeklyBars.length - 1}
          bars={weeklyBars.map((w) => ({ label: w.label, value: w.count, title: `${w.title}: ${w.count}`, href: `/app/musteriler?from=${w.from}&to=${w.to}` }))}
          href={`/app/musteriler?from=${growthFromDate}`}
        />
      ) : null}
    </>
  );
}

/** Yaklaşan doğum günü / yıldönümü hatırlatması. */
async function OccasionsStream({ summary }: { summary: Promise<CustomersSummary> }) {
  const { occasions } = await summary;
  if (occasions.length === 0) return null;
  return (
    // lp-defer: telefonda sayfalamanın altına iner (liste ilk ekranda başlasın).
    <Card className="lp-defer p-4">
      <div className="flex items-center gap-2">
        <Gift aria-hidden="true" className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-semibold text-ink-950">
          Yaklaşan özel günler
          <span className="ml-1.5 font-normal text-text-muted">· önümüzdeki {WINDOW_DAYS} gün</span>
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {occasions.slice(0, 12).map((o) => (
          <li key={`${o.id}-${o.kind}`}>
            <Link
              href={`/app/musteriler/${o.id}`}
              className="focus-ring group inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 touch:min-h-11"
              title={o.note ?? undefined}
            >
              {o.kind === "birthday" ? (
                <Cake aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
              ) : (
                <Gift aria-hidden="true" className="h-3.5 w-3.5 text-text-muted" />
              )}
              <span>{o.name}</span>
              <StatusPill tone={o.days === 0 ? "warning" : "neutral"} dot={false}>
                {o.kind === "birthday" ? "Doğum günü" : "Yıldönümü"} · {occasionLabel(o.days)}
              </StatusPill>
            </Link>
          </li>
        ))}
        {occasions.length > 12 ? (
          <li className="self-center text-xs font-medium text-text-muted">+{occasions.length - 12} daha</li>
        ) : null}
      </ul>
    </Card>
  );
}

type FilterChipsProps = {
  totalAll: number;
  customerTypes: CustomerTypeDefs;
  typeF: string;
  segmentF: HeatSegment | "";
  /** Eylem süzgeci (`?segment=risk|satici`); sıcaklık süzgeciyle aynı parametre. */
  actionSeg: ActionSegment | null;
  /** "Akıllı listeler ve tavsiyeler" modülü (smart_lists) kapalıysa eylem süzgeçleri görünmez. */
  showActions: boolean;
  baseParams: BaseParams;
  /** Telefonda dış kopya `max-sm:hidden`; aynı çipler ListToolbar filtre alt sayfasında (`sheetExtras`) çizilir. */
  className?: string;
};

/** Tip çipleri + sıcaklık segmentleri. `summary` null iken (akış beklerken) sayaçsız, ama tıklanabilir görünür. */
function FilterChipsView({ summary, totalAll, customerTypes, typeF, segmentF, actionSeg, showActions, baseParams, className }: FilterChipsProps & { summary: CustomersSummary | null }) {
  return (
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
      {/* Müşteri tipi çipleri (sunucu filtresi, ?type=) */}
      <CategoryChips
        options={customerTypes.map((t) => ({ value: t.value, label: t.label }))}
        counts={summary?.typeCounts ?? null}
        total={totalAll}
        active={typeF}
        pathname="/app/musteriler"
        params={baseParams}
        paramName="type"
        label="Müşteri tipi"
      />

      {/* Sıcaklık segmentleri (çip = filtre; aktifken tekrar tıklamak kaldırır). Çip tam opak (soluk opaklık AA kontrastı
          bozuyordu); seçili durum halka + aria-current ile verilir: çip bir BAĞLANTIDIR, aria-pressed yalnız düğme rolünde geçerli. */}
      <nav aria-label="Müşteri sıcaklık segmentleri" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-text-muted">Sıcaklık</span>
        {SEGMENT_CARDS.map((card) => {
          const on = segmentF === card.key;
          return (
            <Link
              key={card.key}
              href={on ? customersHref(baseParams, { segment: undefined, sayfa: undefined }) : customersHref(baseParams, { segment: card.key, sayfa: undefined })}
              aria-current={on ? "true" : undefined}
              title={on ? "Filtre aktif — kaldır" : `${HEAT_SEGMENTS[card.key].label} müşterileri göster`}
              className={`focus-ring press inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${PILL_TONE_CLASS[heatTone(card.key)]} ${on ? "ring-2 ring-brand-500" : "hover:brightness-95"} touch:min-h-11`}
            >
              <card.icon aria-hidden="true" className="h-3.5 w-3.5" />
              {HEAT_SEGMENTS[card.key].label}
              {summary ? <span className="numeric">{summary.segmentCounts[card.key]}</span> : null}
            </Link>
          );
        })}
        {summary?.poolLimited ? (
          <span className="text-xs text-text-faint">
            Sayılar filtrelenmiş listenin ilk {HEAT_POOL_LIMIT.toLocaleString("tr-TR")} kaydından hesaplanır (yaklaşık).
          </span>
        ) : null}
      </nav>

      {/* Eylem süzgeçleri: "bugün kimi aramalıyım?" (risk ve satıcı skoru; aynı ?segment= parametresi) */}
      {showActions ? (
        <nav aria-label="Müşteri eylem süzgeçleri" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-text-muted">Kimi aramalıyım?</span>
          {ACTION_SEGMENT_KEYS.map((key) => {
            const on = actionSeg === key;
            return (
              <Link
                key={key}
                href={on ? customersHref(baseParams, { segment: undefined, sayfa: undefined }) : customersHref(baseParams, { segment: key, sayfa: undefined })}
                aria-current={on ? "true" : undefined}
                title={on ? "Süzgeç aktif — kaldır" : ACTION_SEGMENTS[key].sub}
                className={`focus-ring press inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition touch:min-h-11 ${
                  on ? "border-brand-300 bg-brand-600/10 text-brand-700 ring-2 ring-brand-500" : "border-line bg-surface text-text-muted hover:text-text"
                }`}
              >
                {ACTION_SEGMENTS[key].label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

async function FilterChipsStream({ summary, ...rest }: FilterChipsProps & { summary: Promise<CustomersSummary> }) {
  return <FilterChipsView summary={await summary} {...rest} />;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    source?: string;
    etiket?: string;
    from?: string;
    to?: string;
    assigned?: string;
    segment?: string;
    sort?: string;
    sirala?: string;
    yon?: string;
    sayfa?: string;
    yogunluk?: string;
  }>;
}) {
  const { perms, tenantId, userId, role } = await requireModulePage("customers");
  // Kullanıcı kapsamı (ofis bayrağı açıksa): assigned_to üzerinden, yalnız daraltır; KPI sayıları da aynı kapsamla.
  const listScopeP = getListScope({ userId, tenantId, role });
  const invisibleP = getInvisibleFeatures(tenantId, userId);
  const uiPrefsP = getUiPrefs();
  const canCreate = (perms.customers ?? []).includes("create");
  const canEdit = (perms.customers ?? []).includes("edit");
  const canDelete = (perms.customers ?? []).includes("delete");
  const canBulk = canEdit || canDelete;
  const sp = await searchParams;
  // Filtre kontratı: ekran ve rapor aynı normalleştirici + kurucuyu kullanır (src/lib/customer-list-filters.ts).
  const filters = normalizeCustomerFilters(sp);
  const { q, type: typeF, source: sourceF, etiket: etiketF, from: fromF, to: toF, assigned: assignedF } = filters;
  const sortF    = sp.sort     ?? "";
  const density  = densityOf(sp.yogunluk);
  // Sıcaklık segmenti filtresi — yalnız bilinen değerler
  const segmentF: HeatSegment | "" = (HEAT_SEGMENT_KEYS as readonly string[]).includes(sp.segment ?? "")
    ? (sp.segment as HeatSegment)
    : "";


  // Sütun sıralaması: ?sirala=ad|tarih & ?yon=asc|desc (varsayılan: tarih desc)
  const siralaF = sp.sirala === "ad" || sp.sirala === "tarih" ? sp.sirala : "";
  const yonF = sp.yon === "asc" || sp.yon === "desc" ? sp.yon : "";
  const sortKey: "ad" | "tarih" = siralaF === "ad" ? "ad" : "tarih";
  const sortDir: "asc" | "desc" = yonF || (sortKey === "ad" ? "asc" : "desc");

  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  // Özel alan filtresi (?ozel=anahtar:değer): eşleşen kimlikler liste + havuz sorgusuna uygulanır.
  // Kapsam ve özel alan süzgeci birbirinden bağımsız: TEK turda (eskiden ardışık).
  // Süzgeç YOKSA kimlikler beklenmez (customIds=null): tanım okuması yalnız filtre çubuğunu besler ve liste turuyla
  // paralel koşar (eskiden her açılışta listeden ÖNCE ayrı bir gidiş-dönüş).
  const customRaw = customFilterRaw(sp as Record<string, string | undefined>);
  const customFilterP = createClient().then((c) => resolveCustomFieldFilter(c, tenantId, "customer", customRaw));
  const [listScope, customIds, invisible, { simple }] = await Promise.all([
    listScopeP,
    customRaw ? customFilterP.then((f) => f.ids) : Promise.resolve(null),
    invisibleP,
    uiPrefsP,
  ]);
  // Eylem süzgeci (?segment=risk|satici): Akıllı listeler modülü kapalıysa yok sayılır.
  const showActions = !invisible.includes("smart_lists");
  const actionSeg = showActions ? parseActionSegment(sp.segment) : null;

  // Tüm sorgular + skorlama data.ts'te (T1); burada yalnız görünüm.
  const {
    viewModels,
    pageIds,
    rowCount,
    totalAll,
    totalFiltered,
    totalPages,
    rangeStart,
    rangeEnd,
    hotCount,
    advisorList,
    advisorName,
    tenantTags,
    customerTypes,
    sourceEntries,
    sourceLabel,
    savedViews,
    summary,
  } = await measure("musteriler-liste", () => loadCustomersData({ tenantId, filters, segmentF, sortF, sortKey, sortDir, offset, scopeFilter: listScope.filter, customIds }));
  const customFilter = await customFilterP;

  // ---- Link kurucu: filtreler sayfa/sıralama linklerinde korunur ----------
  const baseParams: Record<string, string> = {};
  if (q)         baseParams.q = q;
  if (typeF)     baseParams.type = typeF;
  if (sourceF)   baseParams.source = sourceF;
  if (filters.kanal) baseParams.kanal = filters.kanal;
  if (etiketF)   baseParams.etiket = etiketF;
  if (assignedF) baseParams.assigned = assignedF;
  if (segmentF)  baseParams.segment = segmentF;
  if (actionSeg) baseParams.segment = actionSeg;
  if (fromF)     baseParams.from = fromF;
  if (toF)       baseParams.to = toF;
  if (sortF)     baseParams.sort = sortF;
  if (siralaF)   baseParams.sirala = siralaF;
  if (yonF)      baseParams.yon = yonF;
  if (density === "kompakt") baseParams.yogunluk = "kompakt";
  if (customFilter.active) baseParams.ozel = customFilterValue(customFilter.active.def.key, customFilter.active.value);

  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...baseParams, ...overrides };
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) usp.set(key, value);
    const qs = usp.toString();
    return qs ? `/app/musteriler?${qs}` : "/app/musteriler";
  };

  // Sütun başlığı sıralama linki: aktifse yön değişir, değilse varsayılan yön.
  // "Sıcak önce" görsel sıralamayı ezdiği için başlık tıklaması onu temizler.
  const columnSortActive = sortF !== "hot";
  const sortHeaderHref = (key: "ad" | "tarih") => {
    const isActive = columnSortActive && sortKey === key;
    const nextDir = isActive
      ? (sortDir === "asc" ? "desc" : "asc")
      : key === "ad" ? "asc" : "desc";
    return hrefWith({ sirala: key, yon: nextDir, sort: undefined, sayfa: undefined });
  };


  const chips = buildActiveChips("/app/musteriler", baseParams, [
    { key: "q", label: "Arama" },
    { key: "type", label: "Tip" },
    { key: "source", label: "Kaynak", format: (v) => formatLeadSource(v, sourceLabel) ?? v },
    { key: "kanal", label: "Başvuru kanalı", format: (v) => leadChannelLabel(v) ?? v },
    { key: "etiket", label: "Etiket" },
    { key: "assigned", label: "Danışman", format: (v) => advisorName.get(v) ?? v },
    { key: "from", label: "Başlangıç" },
    { key: "to", label: "Bitiş" },
    { key: "segment", label: "Süzgeç", format: (v) => HEAT_SEGMENTS[v as HeatSegment]?.label ?? ACTION_SEGMENTS[v as ActionSegment]?.label ?? v },
    { key: "sort", label: "Sıralama", format: (v) => (v === "hot" ? "Sıcak önce" : v) },
  ]);
  const savedViewParams = Object.fromEntries(Object.entries(baseParams).filter(([k]) => k !== "yogunluk"));

  // Tip / sıcaklık / eylem çipleri: geniş ekranda araç çubuğunun altında, telefonda filtre alt sayfasında (tek yer).
  const chipsProps: FilterChipsProps = { totalAll, customerTypes, typeF, segmentF, actionSeg, showActions, baseParams };
  const quickChips = (className?: string) =>
    totalAll > 0 ? (
      <Suspense fallback={<FilterChipsView summary={null} {...chipsProps} className={className} />}>
        <FilterChipsStream summary={summary} {...chipsProps} className={className} />
      </Suspense>
    ) : null;


  return (
    <ListPage
      hero={{
        eyebrow: "Müşteri yönetimi",
        title: "Müşteriler",
        art: "musteri",
        description: simple ? undefined : (
          <>
            Alıcı, mülk sahibi ve yatırımcılar; talep, iletişim ve sıcaklık tek ekranda.{" "}
            <HelpTip topic="sicaklik" label="Müşteri sıcaklığı" />
          </>
        ),
        meta: <ScopeBadge text={listScope.badge} />,
        // Tek birincil düğme (C15); "Aynı kişiler" ve "İçe aktar" sade görünümde "Diğer" menüsünde.
        actions: canCreate ? <ButtonLink href="/app/musteriler/yeni" icon={Plus}>Yeni müşteri</ButtonLink> : null,
        more: (
          <>
            <ButtonLink href="/app/musteriler/cift-kayit" variant="secondary" size="sm" icon={Copy}>
              Aynı kişiler
            </ButtonLink>
            {canCreate ? (
              <ButtonLink href="/app/ice-aktarma" variant="secondary" size="sm" icon={Upload}>
                İçe aktar
              </ButtonLink>
            ) : null}
          </>
        ),
      }}
      // KPI şeridi — hepsi tıklanabilir; çubuk/trend yalnız gerçek haftalık kayıt serisinden
      kpis={
        <Suspense fallback={<SkeletonCard height={92} label="Özet göstergeler yükleniyor" />}>
          <KpisStream summary={summary} totalAll={totalAll} baseParams={baseParams} />
        </Suspense>
      }
      charts={
        <Suspense fallback={<SkeletonCard height={220} label="Grafikler yükleniyor" />}>
          <ChartsStream summary={summary} customerTypes={customerTypes} />
        </Suspense>
      }
    >

      {/* Arama listesi girişi (C15): bugün aranacaklar bir dokunuşla; sekme şeridinde saklı kalmasın. */}
      {simple && totalAll > 0 ? (
        <Link
          href="/app/arama-listesi"
          data-call-list-entry=""
          className="focus-ring press flex min-h-14 touch:min-h-11 items-center gap-3 rounded-[var(--radius-card)] border border-brand-300/50 bg-brand-600/[0.06] px-4 text-base font-semibold text-ink-950 transition hover:bg-brand-600/10"
        >
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
            <PhoneCall className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">Bugün kimi aramalıyım?</span>
          <span className="shrink-0 text-sm text-brand-700">Arama listesi <ChevronRight aria-hidden className="inline h-4 w-4" /></span>
        </Link>
      ) : null}

      {/* Yaklaşan doğum günü / yıldönümü hatırlatma (akışla gelir; liste beklemez) */}
      <Suspense fallback={null}>
        <OccasionsStream summary={summary} />
      </Suspense>

      {/* Araç çubuğu: arama + filtre paneli (GET form → URL), yoğunluk, kayıtlı görünümler, aktif filtre çipleri */}
      <ListToolbar
        pathname="/app/musteriler"
        params={baseParams}
        searchPlaceholder="Ad, telefon, e-posta ara…"
        searchLabel="Müşteri ara"
        panelParamKeys={["source", "kanal", "etiket", "assigned", "from", "to"]}
        panel={
          <>
            <FilterGrid>
              <FilterSelect
                name="source"
                label="Kaynak"
                value={sourceF}
                options={[{ value: "", label: "Tüm kaynaklar" }, ...sourceEntries.map(([v, l]) => ({ value: v, label: l }))]}
              />
              <FilterSelect
                name="kanal"
                label="Başvuru kanalı"
                value={filters.kanal}
                options={[
                  { value: "", label: "Tüm kanallar" },
                  ...(filters.kanal && !(LEAD_CHANNEL_OPTIONS as readonly string[]).includes(filters.kanal) ? [{ value: filters.kanal, label: filters.kanal }] : []),
                  ...LEAD_CHANNEL_OPTIONS.map((v) => ({ value: v, label: leadChannelLabel(v) ?? v })),
                ]}
              />
              {tenantTags.length > 0 || etiketF ? (
                <FilterSelect
                  name="etiket"
                  label="Etiket"
                  value={etiketF}
                  options={[
                    { value: "", label: "Tüm etiketler" },
                    ...(etiketF && !tenantTags.includes(etiketF) ? [{ value: etiketF, label: etiketF }] : []),
                    ...tenantTags.map((t) => ({ value: t, label: t })),
                  ]}
                />
              ) : null}
              {advisorList.length > 0 ? (
                <FilterSelect
                  name="assigned"
                  label="Danışman"
                  value={assignedF}
                  options={[{ value: "", label: "Tüm danışmanlar" }, ...advisorList.map((a) => ({ value: a.id, label: a.full_name }))]}
                />
              ) : null}
            </FilterGrid>
            <FilterGrid>
              <label className="grid gap-1 text-xs font-semibold text-text-muted">
                Eklenme (başlangıç)
                <input name="from" type="date" defaultValue={fromF} className="min-h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm font-normal text-text outline-none focus:border-brand-400 touch:min-h-11" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-text-muted">
                Eklenme (bitiş)
                <input name="to" type="date" defaultValue={toF} className="min-h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm font-normal text-text outline-none focus:border-brand-400 touch:min-h-11" />
              </label>
            </FilterGrid>
          </>
        }
        sort={
          <Link
            href={hrefWith({ sort: sortF === "hot" ? undefined : "hot", sayfa: undefined })}
            aria-current={sortF === "hot" ? "true" : undefined}
            title="Bu sayfadaki kayıtları ciddiyet puanına göre sırala"
            className={`focus-ring press inline-flex min-h-9 touch:min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-semibold transition ${
              sortF === "hot" ? "border-brand-300 bg-brand-600/10 text-brand-700" : "border-line bg-surface text-text-muted hover:text-text"
            }`}
          >
            <Flame aria-hidden="true" className="h-4 w-4" />
            Sıcak önce{hotCount > 0 ? <span className="numeric text-xs">· {hotCount}</span> : null}
          </Link>
        }
        densityParam="yogunluk"
        chips={chips}
        resultCount={chips.length > 0 ? totalFiltered : undefined}
        savedViews={<SavedViews route="/app/musteriler" views={savedViews} currentParams={savedViewParams} />}
        sheetParamKeys={["type", "segment", "sort", "ozel"]}
        sheetExtras={
          <>
            {quickChips()}
            <CustomFieldFilterBar path="/app/musteriler" params={baseParams} state={customFilter} />
          </>
        }
      />
      <CustomFieldFilterBar path="/app/musteriler" params={baseParams} state={customFilter} className="max-sm:hidden" />

      {quickChips("max-sm:hidden")}


      {actionSeg && totalAll > 0 ? (
        <Suspense fallback={<SkeletonCard height={320} label="Süzgeç hesaplanıyor" />}>
          <ActionSegmentList segment={actionSeg} tenantId={tenantId} />
        </Suspense>
      ) : totalAll === 0 ? (
        <EmptyState
          icon={ICONS.musteri}
          illustration="musteri"
          title="Henüz müşteri yok"
          description="İlk müşterinizi ekleyin. Arayan, mülk sahibi ve yatırımcıları tek yerde toplayın; hiçbir talebi kaçırmayın."
          action={
            canCreate
              ? { href: "/app/musteriler/yeni", label: "Yeni müşteri" }
              : undefined
          }
          secondary={{ href: "/app/gelen-kutusu", label: "Gelen kutusundan aktar" }}
        />
      ) : rowCount === 0 ? (
        <EmptyState
          icon={Search}
          illustration="search"
          title="Eşleşen müşteri bulunamadı"
          description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
          action={{ href: "/app/musteriler", label: "Filtreleri temizle" }}
        />
      ) : (
        /* key: sayfa/filtre değişince client seçim state'i sıfırlanır —
           önceki sayfadan kalan bayat id'lerle toplu işlem yapılmasın */
        <CustomerBulkProvider key={`${page}|${q}|${typeF}|${sourceF}|${etiketF}|${assignedF}|${segmentF}|${fromF}|${toF}|${siralaF}|${yonF}`}>
          {canBulk ? (
            <CustomerBulkBar advisors={advisorList} tagSuggestions={tenantTags} canEdit={canEdit} canDelete={canDelete} />
          ) : null}
          {canEdit ? <CustomerPortalPanel /> : null}
          <CustomerTable
            rows={viewModels}
            ids={pageIds}
            canBulk={canBulk}
            canEdit={canEdit}
            canDelete={canDelete}
            density={density}
            simple={simple}
            sortHeader={{
              name: (
                <SortHeaderLink href={sortHeaderHref("ad")} active={columnSortActive && sortKey === "ad"} dir={sortDir} label="Müşteri" />
              ),
              created: (
                <SortHeaderLink href={sortHeaderHref("tarih")} active={columnSortActive && sortKey === "tarih"} dir={sortDir} label="Kayıt tarihi" />
              ),
              nameSort: columnSortActive && sortKey === "ad" ? (sortDir === "asc" ? "ascending" : "descending") : undefined,
              createdSort: columnSortActive && sortKey === "tarih" ? (sortDir === "asc" ? "ascending" : "descending") : undefined,
            }}
          />
        </CustomerBulkProvider>
      )}

      {/* Sayfalama — filtre ve sıralama parametreleri linklerde korunur */}
      {totalFiltered > 0 && !actionSeg ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="numeric text-text-muted">
            {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
            {totalFiltered.toLocaleString("tr-TR")}
          </p>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link
                href={hrefWith({ sayfa: page - 1 > 1 ? String(page - 1) : undefined })}
                className={PAGER_BTN}
              >
                <ChevronLeft className="h-4 w-4" /> Önceki
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                <ChevronLeft className="h-4 w-4" /> Önceki
              </span>
            )}
            <span className="numeric px-1 text-text-faint">
              {Math.min(page, totalPages)} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={hrefWith({ sayfa: String(page + 1) })} className={PAGER_BTN}>
                Sonraki <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                Sonraki <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        </div>
      ) : null}
    </ListPage>
  );
}
