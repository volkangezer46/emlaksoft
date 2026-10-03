import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, CalendarX2, FileSignature, PenLine, Plus, Search, Send } from "lucide-react";
import { DAY_MS, daysFromNowIso, msSince, now } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { exportContractsCsv } from "@/app/actions/export";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { relatedSearchClause } from "@/lib/list-search";
import { buildHref } from "@/lib/ui/filter-params";
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
  weeklySeriesOf,
  type KpiItem,
} from "@/components/ui/list-kit";
import { ContractMobileList, ContractTable, type ContractVM } from "./contract-rows";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  contractStatusTone,
  countContractTypes,
  isExpired,
  renewalDays,
  signRate,
} from "./contract-list-logic";

const PATH = "/app/sozlesmeler";

function relativeDate(iso: string) {
  const d = Math.floor(msSince(iso) / DAY_MS);
  if (d <= 0) return "Bugün";
  if (d === 1) return "Dün";
  if (d < 30) return `${d} gün önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
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
/** Tür çipi sayaçları ve haftalık seri için taranan azami kayıt; aşılırsa gizlenir (yaklaşık sayı yok). */
const SCAN_LIMIT = 2000;

export default async function SozlesmelerPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    durum?: string;
    tip?: string;
    customer?: string;
    property?: string;
    from?: string;
    to?: string;
    yenileme?: string;
    sayfa?: string;
    yogunluk?: string;
    yeni?: string;
    tur?: string;
  }>;
}) {
  const { perms } = await requireModulePage("contracts", "/app/sozlesmeler");
  const params = (await searchParams) ?? {};
  const canCreate = perms.contracts?.includes("create") ?? false;
  // Eski popup adresleri: ?yeni=1 ve teklif/randevu ön dolgusu (?customer=&property=&tur=) tam sayfa forma gider.
  if (canCreate && (params.yeni === "1" || params.customer || params.property || params.tur)) {
    const q = new URLSearchParams();
    if (params.customer) q.set("customer", params.customer);
    if (params.property) q.set("property", params.property);
    if (params.tur) q.set("tur", params.tur);
    redirect(`/app/sozlesmeler/yeni${q.size ? `?${q}` : ""}`);
  }
  // Filtre değerleri DB'deki gerçek durum/tür değerleri
  const durum = params.durum && CONTRACT_STATUS_LABELS[params.durum] ? params.durum : "";
  const tip = params.tip && CONTRACT_TYPE_LABELS[params.tip] ? params.tip : "";
  const from = isoDateParam(params.from);
  const to = isoDateParam(params.to);
  const q = (params.q ?? "").trim().slice(0, 80);
  // ?yenileme=1 → yalnız süresi 30 gün içinde dolacak sözleşmeler
  // ?yenileme=gecmis → süresi dolmuş (iptal/red hariç) sözleşmeler
  const yenilemeF = params.yenileme === "1" || params.yenileme === "gecmis" ? params.yenileme : "";
  const yenileme = yenilemeF === "1";
  const gecmis = yenilemeF === "gecmis";
  const density = densityOf(params.yogunluk);
  const page = parsePage(params.sayfa);
  const offset = (page - 1) * PAGE_SIZE;

  const urlParams: Record<string, string> = {};
  if (q) urlParams.q = q;
  if (durum) urlParams.durum = durum;
  if (tip) urlParams.tip = tip;
  if (from) urlParams.from = from;
  if (to) urlParams.to = to;
  if (yenilemeF) urlParams.yenileme = yenilemeF;
  if (density === "kompakt") urlParams.yogunluk = "kompakt";
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));
  const savedViewParams = Object.fromEntries(Object.entries(urlParams).filter(([k]) => k !== "yogunluk"));

  const supabase = await createClient();
  const savedViewsPromise = listSavedViews(PATH);
  const search = await relatedSearchClause(supabase, q, {
    customerColumn: "customer_id",
    propertyColumn: "property_id",
    extraColumns: ["title"],
  });

  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const in30Iso = daysFromNowIso(30);

  const LIST_COLS =
    "id, title, contract_type, status, created_at, signed_at, expires_at, property:properties!contracts_property_id_fkey(id, property_code, title), customer:customers!contracts_customer_id_fkey(id, full_name)";
  let listQuery = supabase.from("contracts").select(LIST_COLS, { count: "exact" });
  if (durum) listQuery = listQuery.eq("status", durum);
  if (tip) listQuery = listQuery.eq("contract_type", tip);
  if (from) listQuery = listQuery.gte("created_at", from);
  if (to) listQuery = listQuery.lt("created_at", nextDay(to));
  if (search.clause) listQuery = listQuery.or(search.clause);
  // ?yenileme=1 — süresi önümüzdeki 30 günde dolan, iptal/red olmayan sözleşmeler;
  // en yakın süre sonu en üstte. Diğer görünümler yeniden eskiye sıralanır.
  if (yenileme) {
    listQuery = listQuery
      .not("expires_at", "is", null)
      .gte("expires_at", nowIso)
      .lte("expires_at", in30Iso)
      .not("status", "in", "(cancelled,rejected)")
      .order("expires_at", { ascending: true });
  } else if (gecmis) {
    listQuery = listQuery
      .not("expires_at", "is", null)
      .lt("expires_at", nowIso)
      .not("status", "in", "(cancelled,rejected)")
      .order("expires_at", { ascending: false });
  } else {
    listQuery = listQuery.order("created_at", { ascending: false });
  }
  listQuery = listQuery.range(offset, offset + PAGE_SIZE - 1);

  const head = () => supabase.from("contracts").select("id", { count: "exact", head: true });
  const statusKeys = Object.keys(CONTRACT_STATUS_LABELS);

  const [listRes, savedViews, totalRes, expiringRes, expiredRes, scanRes, ...statusRes] = await Promise.all([
    search.empty ? Promise.resolve({ data: [], count: 0 }) : listQuery,
    savedViewsPromise,
    head(),
    head().not("expires_at", "is", null).gte("expires_at", nowIso).lte("expires_at", in30Iso).not("status", "in", "(cancelled,rejected)"),
    head().not("expires_at", "is", null).lt("expires_at", nowIso).not("status", "in", "(cancelled,rejected)"),
    // Tür sayaçları + haftalık yeni sözleşme serisi — hafif tarama (SCAN_LIMIT'e dayanırsa gizlenir).
    supabase.from("contracts").select("contract_type, created_at").limit(SCAN_LIMIT),
    ...statusKeys.map((s) => head().eq("status", s)),
  ]);

  const totalAll = totalRes.count ?? 0;
  const statusCounts: Record<string, number> = {};
  statusKeys.forEach((s, i) => {
    statusCounts[s] = (statusRes[i] as { count: number | null }).count ?? 0;
  });
  const expiringCount = expiringRes.count ?? 0;
  const expiredCount = expiredRes.count ?? 0;

  const scanRows = (scanRes.data ?? []) as Array<{ contract_type: string | null; created_at: string }>;
  const typeCounts = scanRows.length >= SCAN_LIMIT ? null : countContractTypes(scanRows);
  const weekly = weeklySeriesOf(scanRows.map((r) => r.created_at), nowMs, SCAN_LIMIT);

  const rowsRaw = (listRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const viewModels: ContractVM[] = rowsRaw.map((c) => {
    const p = one(c.property as { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null);
    const cu = one(c.customer as { id: string; full_name: string } | { id: string; full_name: string }[] | null);
    const status = String(c.status);
    const expiresAt = (c.expires_at as string | null) ?? null;
    const kalan = renewalDays(expiresAt, status, nowMs);
    const signedAt = (c.signed_at as string | null) ?? null;
    return {
      id: String(c.id),
      href: `${PATH}/${c.id}`,
      title: String(c.title),
      typeLabel: CONTRACT_TYPE_LABELS[String(c.contract_type)] ?? String(c.contract_type),
      statusLabel: CONTRACT_STATUS_LABELS[status] ?? status,
      statusTone: contractStatusTone(status),
      renewalLabel: kalan != null ? `Yenileme yaklaşıyor · ${kalan === 0 ? "bugün" : `${kalan} gün`}` : null,
      expired: isExpired(expiresAt, status, nowMs),
      propertyId: p?.id ?? null,
      propertyLabel: p ? (p.title ?? p.property_code) : null,
      customerId: cu?.id ?? null,
      customerName: cu?.full_name ?? null,
      dateLabel: status === "signed" && signedAt ? `İmzalandı: ${relativeDate(signedAt)}` : relativeDate(String(c.created_at)),
    };
  });

  const totalFiltered = listRes.count ?? viewModels.length;
  const win = pageWindow(page, totalFiltered, PAGE_SIZE, viewModels.length);
  const rate = signRate(statusCounts.signed ?? 0, statusCounts.sent ?? 0);

  const kpis: KpiItem[] = [
    {
      label: "Tüm sözleşmeler",
      value: totalAll,
      icon: <FileSignature />,
      tone: "info",
      href: hrefWith({ durum: "", yenileme: "" }),
      series: weekly,
      showTrend: true,
      seriesLabel: "haftalık yeni sözleşme",
      hint: "kayıtlı sözleşme",
    },
    { label: "İmza bekliyor", value: statusCounts.sent ?? 0, icon: <Send />, tone: "warning", href: hrefWith({ durum: "sent", yenileme: "" }), hint: "gönderildi, imzalanmadı" },
    {
      label: "İmzalandı",
      value: statusCounts.signed ?? 0,
      icon: <PenLine />,
      tone: "success",
      href: hrefWith({ durum: "signed", yenileme: "" }),
      hint: rate != null ? `imza oranı %${rate}` : undefined,
    },
    { label: "Süresi yaklaşan", value: expiringCount, icon: <AlarmClock />, tone: "warning", href: hrefWith({ durum: "", yenileme: "1" }), hint: "30 gün içinde" },
    { label: "Süresi dolmuş", value: expiredCount, icon: <CalendarX2 />, tone: "danger", href: hrefWith({ durum: "", yenileme: "gecmis" }), attention: true, hint: "iptal/red hariç" },
  ];

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "durum", label: "Durum", format: (v) => CONTRACT_STATUS_LABELS[v] ?? v },
    { key: "tip", label: "Tür", format: (v) => CONTRACT_TYPE_LABELS[v] ?? v },
    { key: "yenileme", label: "Süre", format: (v) => (v === "gecmis" ? "süresi dolmuş" : "30 gün içinde dolacak") },
    { key: "from", label: "Başlangıç" },
    { key: "to", label: "Bitiş" },
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sözleşmeler"
        title="Sözleşme & E-İmza"
        description="Kira, satış ve diğer sözleşme taslakları oluşturun. İmza linki ile dijital onay alın."
        actions={
          <>
            {totalAll > 0 ? <ExportCsvButton action={exportContractsCsv} label="Dışa aktar" /> : null}
            {canCreate ? <ButtonLink href="/app/sozlesmeler/yeni" icon={Plus}>Yeni sözleşme</ButtonLink> : null}
          </>
        }
      />

      {totalAll === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Henüz sözleşme yok"
          description="İlk sözleşme taslağınızı oluşturun, imzalayanları ekleyin ve dijital onay alın."
          tone="brand"
          action={canCreate ? { label: "Yeni sözleşme", href: "/app/sozlesmeler/yeni" } : undefined}
        />
      ) : (
        <>
          <KpiStrip items={kpis} />

          <ListToolbar
            pathname={PATH}
            params={urlParams}
            searchPlaceholder="Sözleşme, müşteri veya portföy ara…"
            searchLabel="Sözleşme ara"
            panelParamKeys={["tip", "from", "to"]}
            panel={
              <>
                <FilterGrid>
                  <FilterSelect
                    name="tip"
                    label="Tür"
                    value={tip}
                    options={[{ value: "", label: "Tüm türler" }, ...Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))]}
                  />
                </FilterGrid>
                <FilterGrid>
                  <FilterDate name="from" label="Tarih (başlangıç)" value={from} />
                  <FilterDate name="to" label="Tarih (bitiş)" value={to} />
                </FilterGrid>
              </>
            }
            sort={
              <Link
                href={hrefWith({ yenileme: yenileme ? "" : "1" })}
                aria-pressed={yenileme}
                title="Süresi 30 gün içinde dolacak sözleşmeler, en yakın önce"
                className={`focus-ring press inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-semibold transition ${
                  yenileme ? "border-brand-300 bg-brand-600/10 text-brand-700" : "border-line bg-surface text-text-muted hover:text-text"
                }`}
              >
                <AlarmClock aria-hidden="true" className="h-4 w-4" />
                Süresi yaklaşan
              </Link>
            }
            densityParam="yogunluk"
            chips={chips}
            resultCount={chips.length > 0 ? totalFiltered : undefined}
            savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
          />

          <div className="space-y-2">
            <CategoryChips
              options={Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              counts={statusCounts}
              total={totalAll}
              active={durum}
              pathname={PATH}
              params={urlParams}
              paramName="durum"
              label="Sözleşme durumu"
            />
            <CategoryChips
              options={Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              counts={typeCounts}
              total={null}
              active={tip}
              pathname={PATH}
              params={urlParams}
              paramName="tip"
              label="Sözleşme türü"
            />
          </div>

          {viewModels.length === 0 ? (
            <EmptyState
              icon={Search}
              illustration="search"
              title="Eşleşen sözleşme bulunamadı"
              description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
              action={{ href: PATH, label: "Filtreleri temizle" }}
            />
          ) : (
            <>
              <ContractTable rows={viewModels} density={density} />
              <ContractMobileList rows={viewModels} />
            </>
          )}

          <ListPager pathname={PATH} params={urlParams} window={win} total={totalFiltered} />
        </>
      )}

      {/* Bilgi kutusu */}
      <section className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-5 py-4 text-sm text-text-muted">
        <p className="font-semibold text-ink-950">SMS onaylı dijital imza nasıl çalışır?</p>
        <p className="mt-1">
          Sözleşme taslağı oluşturun → imzalayan kişileri ekleyin → sistem benzersiz bir imza linki oluşturur →
          kişi linke tıklayıp onayladığında sözleşme “İmzalandı” durumuna geçer.
          Tüm imzalayanlar onayladığında sözleşme tamamlanır.
        </p>
      </section>
    </div>
  );
}
