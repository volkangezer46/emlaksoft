import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
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
  Plus,
  Search,
  Snowflake,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { formatLeadSource } from "@/lib/lead-sources";
import { exportCustomersCsv } from "@/app/actions/export";
import { HEAT_POOL_LIMIT, hasCustomerFilters, normalizeCustomerFilters } from "@/lib/customer-list-filters";
import { LEAD_CHANNEL_OPTIONS, leadChannelLabel } from "@/lib/lead-channel";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { SavedViews } from "@/components/app/saved-views";
import { CustomerBulkBar, CustomerBulkProvider } from "./customer-bulk-actions";
import { HEAT_SEGMENTS, type HeatSegment } from "@/lib/customer-heat";
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
import { HEAT_SEGMENT_KEYS, PAGE_SIZE, WINDOW_DAYS, loadCustomersData } from "./data";
import { getListScope } from "@/lib/access-control";
import { ScopeBadge } from "@/components/app/scope-badge";
import { createClient } from "@/lib/supabase/server";
import { customFilterRaw, customFilterValue, resolveCustomFieldFilter } from "@/lib/custom-fields/filter";
import { CustomFieldFilterBar } from "@/components/app/custom-field-filter-bar";

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
      className={`focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-0.5 uppercase tracking-[0.04em] transition hover:text-ink-950 ${active ? "text-brand-700" : ""}`}
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
  "focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

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
    yeni?: string;
  }>;
}) {
  const { perms, tenantId, userId, role } = await requireModulePage("customers");
  // Kullanıcı kapsamı (ofis bayrağı açıksa): assigned_to üzerinden, yalnız daraltır; KPI sayıları da aynı kapsamla.
  const listScopeP = getListScope({ userId, tenantId, role });
  const canCreate = (perms.customers ?? []).includes("create");
  const canEdit = (perms.customers ?? []).includes("edit");
  const canDelete = (perms.customers ?? []).includes("delete");
  const canBulk = canEdit || canDelete;
  const sp = await searchParams;
  // Eski popup adresi (?yeni=1; komut paleti, kısayollar) → tam sayfa form.
  if (sp.yeni === "1") redirect("/app/musteriler/yeni");
  // Filtre kontratı: ekran ve CSV aynı normalleştirici + kurucuyu kullanır (src/lib/customer-list-filters.ts).
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
  const [listScope, customFilter] = await Promise.all([
    listScopeP,
    createClient().then((c) => resolveCustomFieldFilter(c, tenantId, "customer", customFilterRaw(sp as Record<string, string | undefined>))),
  ]);

  // Tüm sorgular + skorlama data.ts'te (T1); burada yalnız görünüm.
  const {
    viewModels,
    pageIds,
    rowCount,
    totalAll,
    buyerCount,
    ownerCount,
    totalFiltered,
    totalPages,
    rangeStart,
    rangeEnd,
    hotCount,
    advisorList,
    advisorName,
    occasions,
    growthTotal,
    growthFromDate,
    weeklySeries,
    typeCounts,
    tenantTags,
    customerTypes,
    sourceEntries,
    sourceLabel,
    savedViews,
    segmentCounts,
    poolLimited,
  weeklyBars,
  } = await loadCustomersData({ tenantId, filters, segmentF, sortF, sortKey, sortDir, offset, scopeFilter: listScope.filter, customIds: customFilter.ids });

  // ---- Link kurucu: filtreler sayfa/sıralama linklerinde korunur ----------
  const baseParams: Record<string, string> = {};
  if (q)         baseParams.q = q;
  if (typeF)     baseParams.type = typeF;
  if (sourceF)   baseParams.source = sourceF;
  if (filters.kanal) baseParams.kanal = filters.kanal;
  if (etiketF)   baseParams.etiket = etiketF;
  if (assignedF) baseParams.assigned = assignedF;
  if (segmentF)  baseParams.segment = segmentF;
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

  // ---- KPI şeridi: yalnız gerçekten hesaplanan sayılar -----------------------
  const kpis: KpiItem[] = [
    { label: "Toplam kayıt", value: totalAll, icon: <ICONS.musteri />, tone: "info", href: "/app/musteriler", hint: "kayıtlı müşteri" },
    {
      label: "Aktif alıcı",
      value: buyerCount,
      icon: <UserCheck />,
      tone: "success",
      href: `/app/musteriler?type=${encodeURIComponent("Alıcı")}`,
      hint: "alıcı tipinde",
    },
    {
      label: "Mülk sahibi",
      value: ownerCount,
      icon: <ICONS.portfoy />,
      tone: "neutral",
      href: `/app/musteriler?type=${encodeURIComponent("Mülk sahibi")}`,
      hint: "portföy kaynağı",
    },
    {
      label: "Yeni · son 8 hafta",
      value: growthTotal,
      icon: <TrendingUp />,
      tone: "info",
      href: `/app/musteriler?from=${growthFromDate}`,
      series: weeklySeries,
      showTrend: true,
      seriesLabel: "önceki 4 haftaya göre",
      hint: growthTotal === 0 ? "yeni müşteri eklenmedi" : undefined,
    },
    {
      label: "Sıcak müşteri",
      value: segmentCounts.sicak,
      icon: <Flame />,
      tone: "warning",
      href: hrefWith({ segment: "sicak", sayfa: undefined }),
      hint: poolLimited ? `yaklaşık (ilk ${HEAT_POOL_LIMIT.toLocaleString("tr-TR")} kayıt)` : "şu an en canlı",
    },
  ];

  const chips = buildActiveChips("/app/musteriler", baseParams, [
    { key: "q", label: "Arama" },
    { key: "type", label: "Tip" },
    { key: "source", label: "Kaynak", format: (v) => formatLeadSource(v, sourceLabel) ?? v },
    { key: "kanal", label: "Başvuru kanalı", format: (v) => leadChannelLabel(v) ?? v },
    { key: "etiket", label: "Etiket" },
    { key: "assigned", label: "Danışman", format: (v) => advisorName.get(v) ?? v },
    { key: "from", label: "Başlangıç" },
    { key: "to", label: "Bitiş" },
    { key: "segment", label: "Sıcaklık", format: (v) => HEAT_SEGMENTS[v as HeatSegment]?.label ?? v },
    { key: "sort", label: "Sıralama", format: (v) => (v === "hot" ? "Sıcak önce" : v) },
  ]);
  const savedViewParams = Object.fromEntries(Object.entries(baseParams).filter(([k]) => k !== "yogunluk"));
  const segmentCards = [
    { key: "sicak" as const, icon: Flame },
    { key: "ilgili" as const, icon: Sparkles },
    { key: "soguk" as const, icon: Snowflake },
    { key: "uykuda" as const, icon: Moon },
  ];

  // ---- Grafikler: yalnız güvenilir sayım varsa (tarama kesilmediyse); her sütun filtreli listeye gider ----
  const typeBars = typeCounts
    ? customerTypes.map((t) => ({
        label: t.label,
        value: typeCounts[t.value] ?? 0,
        href: `/app/musteriler?type=${encodeURIComponent(t.value)}`,
      }))
    : [];
  const charts = (
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

  return (
    <ListPage
      hero={{
        eyebrow: "Müşteri yönetimi",
        title: "Müşteriler",
        art: "musteri",
        description: (
          <>
            Alıcı, mülk sahibi ve yatırımcılar; talep, iletişim ve sıcaklık tek ekranda.{" "}
            <HelpTip topic="sicaklik" label="Müşteri sıcaklığı" />
          </>
        ),
        meta: <ScopeBadge text={listScope.badge} />,
        actions: (
          <>
            <ButtonLink href="/app/musteriler/cift-kayit" variant="secondary" size="sm" icon={Copy}>
              Çift kayıt kontrolü
            </ButtonLink>
            {canCreate ? (
              <ButtonLink href="/app/ice-aktarma" variant="secondary" size="sm" icon={Upload}>
                İçe aktar
              </ButtonLink>
            ) : null}
            <ExportCsvButton
              action={exportCustomersCsv.bind(null, filters)}
              fullQuery={new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString()}
              label={hasCustomerFilters(filters) ? "Filtreyi dışa aktar" : "Dışa aktar"}
            />
            {canCreate ? <ButtonLink href="/app/musteriler/yeni" icon={Plus}>Yeni müşteri</ButtonLink> : null}
          </>
        ),
      }}
      // KPI şeridi — hepsi tıklanabilir; çubuk/trend yalnız gerçek haftalık kayıt serisinden
      kpis={<KpiStrip items={kpis} />}
      charts={charts}
    >

      {/* Yaklaşan doğum günü / yıldönümü hatırlatma */}
      {occasions.length > 0 ? (
        <Card className="p-4">
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
                  className="focus-ring group inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
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
      ) : null}

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
                <input name="from" type="date" defaultValue={fromF} className="min-h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm font-normal text-text outline-none focus:border-brand-400" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-text-muted">
                Eklenme (bitiş)
                <input name="to" type="date" defaultValue={toF} className="min-h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 text-sm font-normal text-text outline-none focus:border-brand-400" />
              </label>
            </FilterGrid>
          </>
        }
        sort={
          <Link
            href={hrefWith({ sort: sortF === "hot" ? undefined : "hot", sayfa: undefined })}
            aria-current={sortF === "hot" ? "true" : undefined}
            title="Bu sayfadaki kayıtları aday skoruna göre sırala"
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
      />
      <CustomFieldFilterBar path="/app/musteriler" params={baseParams} state={customFilter} />

      {totalAll > 0 ? (
        <div className="space-y-2">
          {/* Müşteri tipi çipleri (sunucu filtresi, ?type=) */}
          <CategoryChips
            options={customerTypes.map((t) => ({ value: t.value, label: t.label }))}
            counts={typeCounts}
            total={totalAll}
            active={typeF}
            pathname="/app/musteriler"
            params={baseParams}
            paramName="type"
            label="Müşteri tipi"
          />

          {/* Sıcaklık segmentleri — akıllı listeler (çip = filtre; aktifken tekrar tıklamak kaldırır) */}
          <nav aria-label="Müşteri sıcaklık segmentleri" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-text-muted">Sıcaklık</span>
            {segmentCards.map((card) => {
              const on = segmentF === card.key;
              return (
                <Link
                  key={card.key}
                  href={on ? hrefWith({ segment: undefined, sayfa: undefined }) : hrefWith({ segment: card.key, sayfa: undefined })}
                  aria-current={on ? "true" : undefined}
                  title={on ? "Filtre aktif — kaldır" : `${HEAT_SEGMENTS[card.key].label} müşterileri göster`}
                  className={`focus-ring press inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${PILL_TONE_CLASS[heatTone(card.key)]} ${on ? "ring-2 ring-brand-500" : "opacity-85 hover:opacity-100"}`}
                >
                  <card.icon aria-hidden="true" className="h-3.5 w-3.5" />
                  {HEAT_SEGMENTS[card.key].label}
                  <span className="numeric">{segmentCounts[card.key]}</span>
                </Link>
              );
            })}
            {poolLimited ? (
              <span className="text-xs text-text-faint">
                Sayılar filtrelenmiş listenin ilk {HEAT_POOL_LIMIT.toLocaleString("tr-TR")} kaydından hesaplanır (yaklaşık).
              </span>
            ) : null}
          </nav>
        </div>
      ) : null}

      {totalAll === 0 ? (
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
      {totalFiltered > 0 ? (
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
