import { redirect } from "next/navigation";
import { Banknote, CheckCircle2, Plus, Search, Tag, Timer, Undo2 } from "lucide-react";
import { daysAgoIso, now } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { exportOffersCsv } from "@/app/actions/export";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { EmptyState } from "@/components/app/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { relatedSearchClause } from "@/lib/list-search";
import {
  CategoryChips,
  FilterDate,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListPager,
  ListToolbar,
  buildActiveChips,
  densityOf,
  isoDateParam,
  mergeResetPage,
  pageWindow,
  parsePage,
  uuidParam,
  weeklySeriesOf,
  type KpiItem,
} from "@/components/ui/list-kit";
import { buildHref } from "@/lib/ui/filter-params";
import { OfferMobileList, OfferTable, type OfferVM } from "./offer-rows";
import { OFFER_STATUS_LABELS, offerStatusTone, offerVolume } from "./offer-list-logic";

const PATH = "/app/teklifler";

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function tarih(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** `to` günü dahil olsun diye timestamptz karşılaştırmasında ertesi gün (hariç) kullanılır. */
function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Sayfa başına kayıt — gerçek sayfalama. */
const PAGE_SIZE = 50;
/** Hacim / haftalık seri taramalarının azami satırı; tavana dayanırsa rakam/çubuk gösterilmez. */
const SCAN_LIMIT = 1000;
const SERIES_SCAN_LIMIT = 2000;

export default async function TekliflerPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    durum?: string;
    from?: string;
    to?: string;
    danisman?: string;
    musteri?: string;
    portfoy?: string;
    sayfa?: string;
    yogunluk?: string;
    yeni?: string;
  }>;
}) {
  const { perms } = await requireModulePage("offers", "/app/teklifler");
  const canCreate = perms.offers?.includes("create") ?? perms.commissions?.includes("create") ?? false;
  const params = (await searchParams) ?? {};
  // Eski popup adresleri: ?yeni=1 ve eşleştirme kısayolu (?musteri=&portfoy=) artık tam sayfa forma gider.
  if (canCreate && (params.yeni === "1" || params.musteri || params.portfoy)) {
    const q = new URLSearchParams();
    if (params.portfoy) q.set("portfoy", params.portfoy);
    if (params.musteri) q.set("musteri", params.musteri);
    redirect(`/app/teklifler/yeni${q.size ? `?${q}` : ""}`);
  }
  // Filtre değerleri DB'deki gerçek durum enum'ları (draft/submitted/…)
  const durum = params.durum && OFFER_STATUS_LABELS[params.durum] ? params.durum : "";
  const from = isoDateParam(params.from);
  const to = isoDateParam(params.to);
  const q = (params.q ?? "").trim().slice(0, 80);
  const danismanF = uuidParam(params.danisman);
  const density = densityOf(params.yogunluk);
  const page = parsePage(params.sayfa);

  // Doğrulanmış URL durumu — toolbar, çipler, sayfalama ve kayıtlı görünümler TEK kaynaktan beslenir.
  const urlParams: Record<string, string> = {};
  if (q) urlParams.q = q;
  if (durum) urlParams.durum = durum;
  if (from) urlParams.from = from;
  if (to) urlParams.to = to;
  if (danismanF) urlParams.danisman = danismanF;
  if (density === "kompakt") urlParams.yogunluk = "kompakt";
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));
  const savedViewParams = Object.fromEntries(Object.entries(urlParams).filter(([k]) => k !== "yogunluk"));

  const supabase = await createClient();
  const savedViewsPromise = listSavedViews(PATH);
  const search = await relatedSearchClause(supabase, q, { customerColumn: "customer_id", propertyColumn: "property_id" });

  // Danışman = teklifi oluşturan (offers.created_by). Kapsam filtresi: sayaçlar da buna uyar.
  const scope: Record<string, string> = danismanF ? { created_by: danismanF } : {};

  const LIST_COLS =
    "id, amount, counter_amount, status, created_at, created_by, property_id, customer_id, property:properties!offers_property_id_fkey(id, property_code, title), customer:customers!offers_customer_id_fkey(id, full_name)";
  let listQuery = supabase.from("offers").select(LIST_COLS, { count: "exact" }).match(scope);
  if (durum) listQuery = listQuery.eq("status", durum);
  if (from) listQuery = listQuery.gte("created_at", from);
  if (to) listQuery = listQuery.lt("created_at", nextDay(to));
  if (search.clause) listQuery = listQuery.or(search.clause);
  const offset = (page - 1) * PAGE_SIZE;
  listQuery = listQuery.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);

  const countOf = (status?: string) => {
    let c = supabase.from("offers").select("id", { count: "exact", head: true }).match(scope);
    if (status) c = c.eq("status", status);
    return c;
  };
  const statusKeys = Object.keys(OFFER_STATUS_LABELS);

  const [listRes, advisorsRes, totalRes, openVolumeRes, seriesRes, savedViews, ...statusRes] = await Promise.all([
    search.empty ? Promise.resolve({ data: [], count: 0 }) : listQuery,
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    countOf(),
    supabase.from("offers").select("amount, counter_amount").match(scope).in("status", ["submitted", "countered"]).limit(SCAN_LIMIT),
    supabase.from("offers").select("created_at").match(scope).gte("created_at", daysAgoIso(56)).limit(SERIES_SCAN_LIMIT),
    savedViewsPromise,
    ...statusKeys.map((s) => countOf(s)),
  ]);

  const advisors = (advisorsRes.data ?? []).map((a) => ({ id: String(a.id), name: String(a.full_name ?? "") }));
  const advisorName = new Map(advisors.map((a) => [a.id, a.name]));

  const offersRaw = (listRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const viewModels: OfferVM[] = offersRaw.map((o) => {
    const p = one(o.property as { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null);
    const c = one(o.customer as { id: string; full_name: string } | { id: string; full_name: string }[] | null);
    const status = String(o.status);
    return {
      id: String(o.id),
      href: `/app/teklifler/${o.id}`,
      propertyId: p?.id ?? (o.property_id as string | null),
      propertyLabel: p?.title ?? p?.property_code ?? null,
      customerId: c?.id ?? (o.customer_id as string | null),
      customerName: c?.full_name ?? null,
      amount: money(o.amount != null ? Number(o.amount) : null),
      counter: o.counter_amount != null ? money(Number(o.counter_amount)) : null,
      statusLabel: OFFER_STATUS_LABELS[status] ?? status,
      statusTone: offerStatusTone(status),
      advisor: o.created_by ? (advisorName.get(String(o.created_by)) ?? null) : null,
      dateLabel: tarih(String(o.created_at)),
    };
  });

  const totalAll = totalRes.count ?? 0;
  const statusCounts: Record<string, number> = {};
  statusKeys.forEach((s, i) => {
    statusCounts[s] = (statusRes[i] as { count: number | null }).count ?? 0;
  });
  const totalFiltered = listRes.count ?? viewModels.length;
  const win = pageWindow(page, totalFiltered, PAGE_SIZE, viewModels.length);

  const openRows = ((openVolumeRes.data ?? []) as Array<{ amount: number | string | null; counter_amount: number | string | null }>).map((r) => ({
    amount: r.amount != null ? Number(r.amount) : null,
    counter: r.counter_amount != null ? Number(r.counter_amount) : null,
  }));
  const openVolume = offerVolume(openRows, SCAN_LIMIT);
  const weekly = weeklySeriesOf(((seriesRes.data ?? []) as Array<{ created_at: string }>).map((r) => r.created_at), now(), SERIES_SCAN_LIMIT);

  const kpis: KpiItem[] = [
    {
      label: "Tüm teklifler",
      value: totalAll,
      icon: <Tag />,
      tone: "info",
      href: hrefWith({ durum: "" }),
      series: weekly,
      showTrend: true,
      seriesLabel: "haftalık yeni teklif",
      hint: "kayıtlı teklif",
    },
    { label: "Sunuldu (bekliyor)", value: statusCounts.submitted ?? 0, icon: <Timer />, tone: "info", href: hrefWith({ durum: "submitted" }), hint: "yanıt bekliyor" },
    { label: "Karşı teklif", value: statusCounts.countered ?? 0, icon: <Undo2 />, tone: "warning", href: hrefWith({ durum: "countered" }), hint: "pazarlık sürüyor" },
    { label: "Kabul edildi", value: statusCounts.accepted ?? 0, icon: <CheckCircle2 />, tone: "success", href: hrefWith({ durum: "accepted" }), hint: "anlaşmaya dönüşebilir" },
  ];
  if (openVolume !== null) {
    kpis.push({ label: "Masadaki hacim", value: money(openVolume), icon: <Banknote />, tone: "neutral", href: hrefWith({ durum: "submitted" }), hint: "sunuldu + karşı teklif" });
  }

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "durum", label: "Durum", format: (v) => OFFER_STATUS_LABELS[v] ?? v },
    { key: "danisman", label: "Danışman", format: (v) => advisorName.get(v) ?? "Seçili danışman" },
    { key: "from", label: "Başlangıç" },
    { key: "to", label: "Bitiş" },
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Teklif takibi"
        title="Teklifler"
        description="Portföylere gelen teklifleri ve durumlarını izleyin."
        actions={
          <>
            <ExportCsvButton action={exportOffersCsv} label="Dışa aktar" />
            {canCreate ? <ButtonLink href="/app/teklifler/yeni" icon={Plus}>Yeni teklif</ButtonLink> : null}
          </>
        }
      />

      {totalAll === 0 && !danismanF ? (
        <EmptyState
          icon={Tag}
          title="Henüz teklif yok"
          description="Portföylere gelen teklifler burada listelenir. Portföy detayından veya “Yeni teklif” ile ilk teklifi ekleyin."
          action={canCreate ? { href: "/app/teklifler/yeni", label: "Yeni teklif" } : undefined}
        />
      ) : (
        <>
          <KpiStrip items={kpis} />

          <ListToolbar
            pathname={PATH}
            params={urlParams}
            searchPlaceholder="Portföy veya müşteri ara…"
            searchLabel="Teklif ara"
            panelParamKeys={["danisman", "from", "to"]}
            panel={
              <>
                {advisors.length > 0 ? (
                  <FilterGrid>
                    <FilterSelect
                      name="danisman"
                      label="Danışman"
                      value={danismanF}
                      options={[{ value: "", label: "Tüm danışmanlar" }, ...advisors.map((a) => ({ value: a.id, label: a.name }))]}
                    />
                  </FilterGrid>
                ) : null}
                <FilterGrid>
                  <FilterDate name="from" label="Tarih (başlangıç)" value={from} />
                  <FilterDate name="to" label="Tarih (bitiş)" value={to} />
                </FilterGrid>
              </>
            }
            densityParam="yogunluk"
            chips={chips}
            resultCount={chips.length > 0 ? totalFiltered : undefined}
            savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
          />

          <CategoryChips
            options={statusKeys.map((k) => ({ value: k, label: OFFER_STATUS_LABELS[k]! }))}
            counts={statusCounts}
            total={totalAll}
            active={durum}
            pathname={PATH}
            params={urlParams}
            paramName="durum"
            label="Teklif durumu"
          />

          {viewModels.length === 0 ? (
            <EmptyState
              icon={Search}
              illustration="search"
              title="Eşleşen teklif bulunamadı"
              description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
              action={{ href: PATH, label: "Filtreleri temizle" }}
            />
          ) : (
            <>
              <OfferTable rows={viewModels} density={density} />
              <OfferMobileList rows={viewModels} />
            </>
          )}

          <ListPager pathname={PATH} params={urlParams} window={win} total={totalFiltered} />
        </>
      )}
    </div>
  );
}
