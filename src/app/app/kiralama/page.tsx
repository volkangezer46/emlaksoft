import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";
import { AlertTriangle, CalendarClock, Hourglass, KeyRound, PieChart, Plus, Search, Wallet, Wrench } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { batchAll } from "@/lib/supabase/query-batch";
import { computeLegalIncreaseIn } from "@/lib/tufe";
import { loadTufeTable } from "@/lib/tufe-server";
import { EmptyState } from "@/components/ui/empty-state";
import { ListLimitNotice } from "@/components/app/list-limit-notice";
import { Badge } from "@/components/ui/badge";
import { ApplyIncreaseDialog } from "./apply-increase-dialog";
import { ButtonLink } from "@/components/ui/button";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { exportRentalsCsv } from "@/app/actions/export";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { DistributionCard, ListCharts, ListHero, ListPage } from "@/components/ui/list-page";
import { buildHref } from "@/lib/ui/filter-params";
import {
  CategoryChips,
  FilterGrid,
  FilterSelect,
  KpiStrip,
  ListPager,
  ListToolbar,
  buildActiveChips,
  densityOf,
  mergeResetPage,
  pageWindow,
  parsePage,
  type KpiItem,
} from "@/components/ui/list-kit";
import { RentalMobileList, RentalTable, type RentalVM } from "./rental-rows";
import { ReminderSettingsCard } from "./reminder-settings-card";
import { normalizeReminderSettings } from "@/lib/rent-reminders/logic";
import { isTenantSmsAvailable } from "@/lib/messaging/tenant-providers";
import {
  DURUM_FILTERS,
  DURUM_LABELS,
  EVRELER,
  EVRE_META,
  dueDateOf,
  evreOf,
  matchesRentalFilters,
  nextAnniversaryOf,
  nextMonthOf,
  type DurumFilter,
  type Evre,
} from "./rental-list-logic";

export const metadata = { title: "Kiralama" };

const PATH = "/app/kiralama";

/** Yaşam döngüsü dilim rengi (viz token; EVRE_META tonlarıyla aynı anlam). */
const EVRE_COLOR: Record<string, string> = {
  yeni: "var(--viz-1)",
  devam: "var(--viz-pos)",
  yenileme: "var(--viz-5)",
  bitiyor: "var(--viz-neg)",
  bitti: "var(--viz-neutral)",
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}
function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(`${iso}T00:00:00`));
}

type Rel<T> = T | T[] | null;
function rel<T>(v: Rel<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Sayfa başına kayıt (bellek içi sayfalama: evre/tahsilat süzgeçleri türetilmiş veriye dayanır). */
const PAGE_SIZE = 50;
/** Kira kaydı tarama sınırı; aşılırsa ListLimitNotice açıkça söyler, evre sayaçları gizlenir. */
const RENTAL_LIMIT = 300;
const CHARGE_LIMIT = 2000;

export default async function KiralamaPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    durum?: string;
    ariza?: string;
    evre?: string;
    portfoy?: string;
    musteri?: string;
    tutar?: string;
    sayfa?: string;
    yogunluk?: string;
  }>;
}) {
  const { perms, tenantId, role } = await requireModulePage("rentals", "/app/kiralama");
  const params = (await searchParams) ?? {};
  // Kazanılan KİRA anlaşmasının köprüsü (?portfoy=&musteri=&tutar=) artık tam sayfa forma gider.
  if (params.portfoy || params.musteri || params.tutar) {
    const q = new URLSearchParams();
    if (params.portfoy) q.set("portfoy", params.portfoy);
    if (params.musteri) q.set("musteri", params.musteri);
    if (params.tutar) q.set("tutar", params.tutar);
    redirect(`/app/kiralama/yeni?${q.toString()}`);
  }
  const durumF = DURUM_FILTERS.includes(params.durum as DurumFilter) ? (params.durum as DurumFilter) : "";
  const arizaF = params.ariza === "acik";
  const evreF = EVRELER.includes(params.evre as Evre) ? (params.evre as Evre) : "";
  const q = (params.q ?? "").trim().slice(0, 80);
  const density = densityOf(params.yogunluk);
  const page = parsePage(params.sayfa);
  const canCreate = perms.rentals?.includes("create") ?? false;
  const canEdit = perms.rentals?.includes("edit") ?? false;

  const urlParams: Record<string, string> = {};
  if (q) urlParams.q = q;
  if (durumF) urlParams.durum = durumF;
  if (arizaF) urlParams.ariza = "acik";
  if (evreF) urlParams.evre = evreF;
  if (density === "kompakt") urlParams.yogunluk = "kompakt";
  const hrefWith = (patch: Record<string, string>) => buildHref(PATH, mergeResetPage(urlParams, patch));
  const savedViewParams = Object.fromEntries(Object.entries(urlParams).filter(([k]) => k !== "yogunluk"));

  const today = daysAgoIso(0).slice(0, 10);
  const curMonth = today.slice(0, 7);
  const curPeriodPrefix = `${curMonth}-01`;
  const in30 = daysFromNowIso(30).slice(0, 10);
  const in60 = daysFromNowIso(60).slice(0, 10);

  const supabase = await createClient();
  // Kiracı hatırlatma ayarı (KAPALI doğar): tablo yoksa (migration uygulanmamış) kart "etkin değil" der, sayfa düşmez.
  const reminderRes = await supabase.from("rent_reminder_settings").select("*").maybeSingle();
  const reminderSchemaReady = !reminderRes.error;
  const reminderSettings = normalizeReminderSettings(reminderRes.error ? null : (reminderRes.data as Record<string, unknown> | null));
  const smsAvailable = tenantId ? await isTenantSmsAvailable(tenantId).catch(() => false) : false;
  const savedViewsPromise = listSavedViews(PATH);
  const [rentalRes, curChargeRes, overdueChargeRes, overdueHead, maintRes, activeHead, savedViews] = await batchAll("Kiralama", [
    "rentals", "charges-current", "charges-overdue", "charges-overdue-count", "maintenance", "rentals-active", "saved-views",
  ], [
    supabase
      .from("rentals")
      .select(
        "id, monthly_rent, due_day, start_date, end_date, status, created_at, property:properties!rentals_property_id_fkey(id, property_code, title), renter:customers!rentals_renter_customer_id_fkey(id, full_name)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .limit(RENTAL_LIMIT),
    // Bu ayın tahakkukları (tahsilat/bekleyen toplamları + satır durumu)
    supabase.from("rent_charges").select("rental_id, amount, status").eq("period", curPeriodPrefix).limit(CHARGE_LIMIT),
    // Geciken tahakkuklar (hangi dönemde olursa olsun) — satır işareti için kira kimlikleri
    supabase.from("rent_charges").select("rental_id").eq("status", "overdue").limit(CHARGE_LIMIT),
    supabase.from("rent_charges").select("id", { count: "exact", head: true }).eq("status", "overdue"),
    supabase.from("maintenance_requests").select("rental_id").neq("status", "done").limit(CHARGE_LIMIT),
    supabase.from("rentals").select("id", { count: "exact", head: true }).eq("status", "active"),
    savedViewsPromise,
  ]);

  const rentals = rentalRes.data ?? [];
  const rentalTotal = rentalRes.count ?? rentals.length;
  const truncated = rentalTotal > rentals.length;
  const curCharges = curChargeRes.data ?? [];
  const sumsReliable = curCharges.length < CHARGE_LIMIT;

  const curMonthByRental = new Map<string, string>();
  let paidSum = 0;
  let pendingSum = 0;
  for (const c of curCharges) {
    curMonthByRental.set(String(c.rental_id), String(c.status));
    if (c.status === "paid") paidSum += Number(c.amount);
    if (c.status === "pending") pendingSum += Number(c.amount);
  }
  const overdueRentals = new Set((overdueChargeRes.data ?? []).map((c) => String(c.rental_id)));
  const overdueCount = overdueHead.count ?? 0;
  const openMaintRentals = new Set((maintRes.data ?? []).map((m) => String(m.rental_id)));
  const openMaint = (maintRes.data ?? []).length;
  const activeCount = activeHead.count ?? 0;

  // ---- Yenileme radarı: yıldönümü YA DA sözleşme bitişi 60 gün içinde ----
  // TÜFE: yönetimin /admin/ayarlar/tufe tablosu (yoksa gömülü, doğrulanmamış tablo); yasal artış işlemiyle (rentals.ts) aynı kaynak.
  const tufeTable = await loadTufeTable();
  const renewalRadar = rentals
    .filter((r) => r.status === "active")
    .flatMap((r) => {
      const anniversary = nextAnniversaryOf(String(r.start_date), today);
      const annDue = anniversary && anniversary <= in60 ? anniversary : null;
      const endDue = r.end_date && r.end_date >= today && r.end_date <= in60 ? String(r.end_date) : null;
      // İkisi de penceredeyse erken olan esas alınır
      const renewalDate = annDue && endDue ? (annDue < endDue ? annDue : endDue) : (annDue ?? endDue);
      if (!renewalDate) return [];
      const current = Number(r.monthly_rent);
      const increase = computeLegalIncreaseIn(tufeTable, current, renewalDate.slice(0, 7));
      return [{ rental: r, renewalDate, current, increase }];
    })
    .sort((a, b) => (a.renewalDate < b.renewalDate ? -1 : 1));

  // ---- Sözleşme yaşam döngüsü ----
  const renewalIds = new Set(renewalRadar.map(({ rental }) => String(rental.id)));
  const yeni90 = daysAgoIso(90).slice(0, 10);
  const evreCtx = { today, in30, yeni90, renewalIds };
  const evreOfRental = (r: { id: string; status: string; start_date: string; end_date: string | null }) => evreOf(r, evreCtx);
  const evreCounts: Record<string, number> = { yeni: 0, devam: 0, yenileme: 0, bitiyor: 0, bitti: 0 };
  for (const r of rentals) {
    evreCounts[evreOfRental({ id: String(r.id), status: String(r.status), start_date: String(r.start_date), end_date: r.end_date ? String(r.end_date) : null })] += 1;
  }

  // ---- Liste filtreleri (arama + KPI drill-down hedefleri) ----
  const filterCtx = {
    evreOf: evreOfRental,
    openMaintRentals,
    overdueRentals,
    curMonthStatus: (id: string) => curMonthByRental.get(id),
  };
  const filtered = rentals.filter((r) => {
    const prop = rel(r.property);
    const renter = rel(r.renter);
    return matchesRentalFilters(
      {
        id: String(r.id),
        status: String(r.status),
        start_date: String(r.start_date),
        end_date: r.end_date ? String(r.end_date) : null,
        text: `${prop?.title ?? ""} ${prop?.property_code ?? ""} ${renter?.full_name ?? ""}`.toLocaleLowerCase("tr-TR"),
      },
      { evre: evreF, ariza: arizaF, durum: durumF, q },
      filterCtx,
    );
  });
  const win = pageWindow(page, filtered.length, PAGE_SIZE, filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).length);
  const pageRows = filtered.slice(win.offset, win.offset + PAGE_SIZE);

  const viewModels: RentalVM[] = pageRows.map((r) => {
    const prop = rel(r.property);
    const renter = rel(r.renter);
    const curStatus = curMonthByRental.get(String(r.id));
    // Sonraki vade: bu ay ödenmişse gelecek ay, değilse bu ayın vadesi
    const dueMonth = curStatus === "paid" ? nextMonthOf(curMonth) : curMonth;
    const nextDue = dueDateOf(dueMonth, Number(r.due_day));
    const active = r.status === "active";
    const evre = evreOfRental({ id: String(r.id), status: String(r.status), start_date: String(r.start_date), end_date: r.end_date ? String(r.end_date) : null });
    return {
      id: String(r.id),
      href: `${PATH}/${r.id}`,
      propertyId: prop?.id ?? null,
      propertyLabel: prop ? (prop.title ?? prop.property_code) : null,
      renterId: renter?.id ?? null,
      renterName: renter?.full_name ?? null,
      rent: money(Number(r.monthly_rent)),
      nextDue: active ? dateLabel(nextDue) : null,
      duePast: active && nextDue < today,
      active,
      evreLabel: EVRE_META[evre].label,
      evreTone: EVRE_META[evre].tone,
      endingSoon: Boolean(active && r.end_date && r.end_date >= today && r.end_date <= in30),
      overdue: overdueRentals.has(String(r.id)),
      maintenance: openMaintRentals.has(String(r.id)),
    };
  });

  const kpis: KpiItem[] = [
    { label: "Aktif kira", value: activeCount, icon: <KeyRound />, tone: "info", href: hrefWith({ durum: "", ariza: "", evre: "" }), hint: "sürmekte olan kira" },
  ];
  if (sumsReliable) {
    kpis.push({ label: "Bu ay tahsilat", value: money(paidSum), icon: <Wallet />, tone: "success", href: hrefWith({ durum: "paid", evre: "" }), hint: "ödenen tahakkuk" });
    kpis.push({ label: "Bu ay bekleyen", value: money(pendingSum), icon: <Hourglass />, tone: "warning", href: hrefWith({ durum: "pending", evre: "" }), hint: "vadesi gelmemiş/ödenmemiş" });
  }
  kpis.push({ label: "Geciken tahakkuk", value: overdueCount, icon: <AlertTriangle />, tone: "danger", href: hrefWith({ durum: "overdue", evre: "" }), attention: true, hint: "tüm dönemler" });
  kpis.push({ label: "Açık arıza", value: openMaint, icon: <Wrench />, tone: openMaint > 0 ? "warning" : "neutral", href: hrefWith({ ariza: "acik", evre: "" }), hint: "bakım talebi" });

  const chips = buildActiveChips(PATH, urlParams, [
    { key: "q", label: "Arama" },
    { key: "evre", label: "Evre", format: (v) => EVRE_META[v as Evre]?.label ?? v },
    { key: "durum", label: "Tahsilat", format: (v) => DURUM_LABELS[v as DurumFilter] ?? v },
    { key: "ariza", label: "Arıza", format: () => "Açık arıza" },
  ]);

  return (
    <ListPage>
      <ListHero
        art="kiralama"
        title="Kiralama"
        eyebrow="Mülk yönetimi"
        description="Kira sözleşmeleri, aylık tahakkuklar ve bakım talepleri tek yerde."
        actions={
          <>
            <ButtonLink href="/app/kira-artis" variant="secondary" size="sm">
              Kira artış hesaplayıcı
            </ButtonLink>
            <ExportCsvButton label="Dışa aktar" action={exportRentalsCsv.bind(null, { durum: durumF, ariza: arizaF ? "acik" : "", evre: evreF })} />
            {canCreate ? <ButtonLink href="/app/kiralama/yeni" icon={Plus}>Yeni kira kaydı</ButtonLink> : null}
          </>
        }
      />

      <ReminderSettingsCard initial={reminderSettings} smsAvailable={smsAvailable} canEdit={canEdit && ["owner", "gm", "branch_manager"].includes(role)} schemaReady={reminderSchemaReady} />

      {rentals.length === 0 && rentalTotal === 0 ? (
        <EmptyState illustration="portfoy"
          icon={KeyRound}
          title="Henüz kira kaydı yok"
          description="Portföyünüzdeki kiralık mülkleri kiracısıyla eşleştirip aylık tahakkukları buradan takip edin."
          tone="brand"
          action={canCreate ? { href: "/app/kiralama/yeni", label: "Yeni kira kaydı" } : undefined}
        />
      ) : (
        <>
          <KpiStrip items={kpis} />

          {/* Yaşam döngüsü + bu ayın tahsilatı (gerçek veri; kesilmiş taramada/güvenilmez toplamda kart yok) */}
          <ListCharts>
            {truncated ? null : (
              <DistributionCard
                title="Sözleşme yaşam döngüsü"
                subtitle="Yeni, devam eden, yenileme ve biten kiralar"
                icon={PieChart}
                href={PATH}
                centerLabel="kira"
                slices={(Object.keys(EVRE_META) as (keyof typeof EVRE_META)[]).map((k) => ({
                  label: EVRE_META[k].label,
                  value: evreCounts[k] ?? 0,
                  color: EVRE_COLOR[k],
                  href: `${PATH}?evre=${k}`,
                }))}
              />
            )}
            {sumsReliable ? (
              <DistributionCard
                title="Bu ayın tahsilatı"
                subtitle="Ödenen ve bekleyen tahakkuk tutarı"
                icon={Wallet}
                tone="success"
                format="money"
                href={`${PATH}?durum=pending`}
                centerLabel="bu ay"
                slices={[
                  { label: "Tahsil edildi", value: paidSum, tone: "success", href: `${PATH}?durum=paid` },
                  { label: "Bekleyen", value: pendingSum, tone: "warn", href: `${PATH}?durum=pending` },
                ]}
              />
            ) : null}
          </ListCharts>

          {/* Yenileme radarı — yıldönümü/bitişi 60 gün içindeki aktif kiralar */}
          {renewalRadar.length > 0 ? (
            <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
                  <CalendarClock className="h-4 w-4 text-brand-600" /> Yenileme radarı
                  <span className="numeric rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700">{renewalRadar.length}</span>
                </h2>
                <p className="text-xs text-text-muted">Önümüzdeki 60 gün — önerilen kira TÜFE tavanına göre hesaplanır (TBK m.344).</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {renewalRadar.map(({ rental: r, renewalDate, current, increase }) => {
                  const prop = rel(r.property);
                  const renter = rel(r.renter);
                  const propName = prop?.title ?? prop?.property_code ?? "Portföy";
                  return (
                    <div key={r.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {prop ? (
                            <Link href={`/app/portfoyler/${prop.id}`} className="focus-ring block truncate rounded-[var(--radius-control)] text-sm font-bold text-ink-950 hover:text-brand-600 hover:underline">
                              {propName}
                            </Link>
                          ) : (
                            <p className="truncate text-sm font-bold text-ink-950">{propName}</p>
                          )}
                          {renter ? (
                            <Link href={`/app/musteriler/${renter.id}`} className="focus-ring rounded-[var(--radius-control)] text-xs text-text-muted hover:text-brand-600 hover:underline">
                              {renter.full_name ?? "İsimsiz"}
                            </Link>
                          ) : (
                            <p className="text-xs text-text-muted">—</p>
                          )}
                        </div>
                        <Badge variant="warning" size="sm" className="shrink-0">
                          +%{increase.appliedRate.toFixed(1)}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-[var(--radius-control)] bg-surface p-2">
                          <p className="text-xs text-text-muted">Mevcut kira</p>
                          <p className="text-sm font-bold text-ink-950">{money(current)}</p>
                        </div>
                        <div className="rounded-[var(--radius-control)] bg-surface p-2">
                          <p className="text-xs text-text-muted">Yenileme</p>
                          <p className="text-sm font-bold text-ink-950">{dateLabel(renewalDate)}</p>
                        </div>
                        <div className="rounded-[var(--radius-control)] bg-surface p-2">
                          <p className="text-xs text-text-muted">Önerilen</p>
                          <p className="text-sm font-bold text-mint-600">{money(increase.newRent)}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/app/kiralama/${r.id}`} className="focus-ring rounded-[var(--radius-control)] text-xs font-semibold text-brand-600 hover:underline">
                          Kira detayı
                        </Link>
                        {canEdit ? (
                          <ApplyIncreaseDialog
                            rentalId={String(r.id)}
                            propertyName={propName}
                            currentRent={current}
                            suggestedRent={increase.newRent}
                            appliedRate={increase.appliedRate}
                            renewalDate={renewalDate}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <ListToolbar
            pathname={PATH}
            params={urlParams}
            searchPlaceholder="Portföy veya kiracı ara…"
            searchLabel="Kira ara"
            panelParamKeys={["durum", "ariza"]}
            panel={
              <FilterGrid>
                <FilterSelect
                  name="durum"
                  label="Tahsilat durumu"
                  value={durumF}
                  options={[{ value: "", label: "Tümü" }, ...DURUM_FILTERS.map((d) => ({ value: d, label: DURUM_LABELS[d] }))]}
                />
                <FilterSelect
                  name="ariza"
                  label="Bakım"
                  value={arizaF ? "acik" : ""}
                  options={[
                    { value: "", label: "Tümü" },
                    { value: "acik", label: "Açık arızası olan" },
                  ]}
                />
              </FilterGrid>
            }
            densityParam="yogunluk"
            chips={chips}
            resultCount={chips.length > 0 ? filtered.length : undefined}
            savedViews={<SavedViews route={PATH} views={savedViews} currentParams={savedViewParams} />}
          />

          <CategoryChips
            options={EVRELER.map((e) => ({ value: e, label: EVRE_META[e].label }))}
            counts={truncated ? null : evreCounts}
            total={truncated ? null : rentals.length}
            active={evreF}
            pathname={PATH}
            params={urlParams}
            paramName="evre"
            label="Sözleşme evresi"
          />

          {truncated ? (
            <ListLimitNotice shown={rentals.length} total={rentalTotal} hint="Arama ve süzgeçler son eklenen kayıtlar içinde çalışır; evre sayaçları gizlendi." />
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              illustration="search"
              title="Eşleşen kira kaydı bulunamadı"
              description="Arama ifadenizi ya da filtreleri değiştirip tekrar deneyin."
              tone="brand"
              action={{ href: PATH, label: "Filtreleri temizle" }}
            />
          ) : (
            <>
              <RentalTable rows={viewModels} density={density} />
              <RentalMobileList rows={viewModels} />
            </>
          )}

          <ListPager pathname={PATH} params={urlParams} window={win} total={filtered.length} />
        </>
      )}
    </ListPage>
  );
}
