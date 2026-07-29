import Link from "next/link";
import { daysAgoIso, daysFromNowIso } from "@/lib/clock";
import { Activity, AlertTriangle, CalendarClock, Hourglass, KeyRound, Wallet, Wrench, X } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { computeLegalIncrease } from "@/lib/tufe";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ApplyIncreaseDialog } from "./apply-increase-dialog";
import { NewRentalDialog } from "./new-rental-dialog";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { exportRentalsCsv } from "@/app/actions/export";

export const metadata = { title: "Kiralama" };

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

const DURUM_FILTERS = ["paid", "pending", "overdue"] as const;
type DurumFilter = (typeof DURUM_FILTERS)[number];
const DURUM_LABELS: Record<DurumFilter, string> = {
  paid: "Bu ay tahsil edilen",
  pending: "Bu ay bekleyen",
  overdue: "Geciken",
};

/** Sözleşme yaşam döngüsü evreleri — şerit ve çipler listeyi ?evre= ile süzer. */
const EVRELER = ["yeni", "devam", "yenileme", "bitiyor", "bitti"] as const;
type Evre = (typeof EVRELER)[number];
const EVRE_META: Record<Evre, { label: string; bar: string; dot: string; text: string }> = {
  yeni:     { label: "Yeni (ilk 90 gün)",    bar: "bg-brand-500",   dot: "bg-brand-500",   text: "text-brand-600" },
  devam:    { label: "Devam eden",           bar: "bg-mint-500",    dot: "bg-mint-500",    text: "text-mint-600" },
  yenileme: { label: "Yenileme penceresi",   bar: "bg-amber-400",   dot: "bg-amber-400",   text: "text-amber-600" },
  bitiyor:  { label: "Bitmek üzere (30 gün)", bar: "bg-danger-500", dot: "bg-danger-500",  text: "text-danger-500" },
  bitti:    { label: "Sona ermiş",           bar: "bg-ink-950/25",  dot: "bg-ink-950/25",  text: "text-text-muted" },
};

/** `YYYY-MM` + vade günü → `YYYY-MM-DD` vade tarihi (string karşılaştırması yeterli). */
function dueDateOf(month: string, dueDay: number) {
  return `${month}-${String(dueDay).padStart(2, "0")}`;
}
function nextMonthOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * start_date'in bugünden sonraki ilk yıldönümü (`YYYY-MM-DD`).
 * İlk yıl dolmadan yıldönümü sayılmaz; 29 Şubat 28'e sabitlenir
 * (string karşılaştırması yeterli, Date aritmetiği gerekmez).
 */
function nextAnniversaryOf(startDate: string, today: string): string | null {
  const mm = startDate.slice(5, 7);
  const dd = mm === "02" && startDate.slice(8, 10) === "29" ? "28" : startDate.slice(8, 10);
  const y = Number(today.slice(0, 4));
  let cand = `${y}-${mm}-${dd}`;
  if (cand < today) cand = `${y + 1}-${mm}-${dd}`;
  return cand > startDate ? cand : null;
}

export default async function KiralamaPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; ariza?: string; evre?: string; portfoy?: string; musteri?: string; tutar?: string }>;
}) {
  const { perms } = await requireModulePage("rentals");
  const params = (await searchParams) ?? {};
  /*
   * Kazanılan KİRA anlaşmasının köprüsü: kazanma sihirbazı
   * /app/kiralama?portfoy=&musteri=&tutar= ile gelir. Bunlar liste filtresi
   * değil, "yeni kira kaydı" diyaloğunun ön dolgusudur — diyalog açık gelir.
   */
  const prefillPropertyId = (params.portfoy ?? "").trim() || null;
  const prefillCustomerId = (params.musteri ?? "").trim() || null;
  const prefillRentParsed = Number(params.tutar ?? "");
  const prefillRent =
    Number.isFinite(prefillRentParsed) && prefillRentParsed > 0 ? Math.round(prefillRentParsed) : null;
  const durumF = DURUM_FILTERS.includes(params.durum as DurumFilter) ? (params.durum as DurumFilter) : "";
  const arizaF = params.ariza === "acik";
  const evreF = EVRELER.includes(params.evre as Evre) ? (params.evre as Evre) : "";
  const canCreate = perms.rentals?.includes("create") ?? false;

  const supabase = await createClient();
  const [{ data: rentalData }, { data: chargeData }, { data: maintData }, { data: propData }, { data: custData }] =
    await Promise.all([
      supabase
        .from("rentals")
        .select(
          "id, monthly_rent, due_day, start_date, end_date, status, created_at, property:properties(id, property_code, title), renter:customers(id, full_name)",
        )
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("rent_charges")
        .select("id, rental_id, period, amount, status")
        .order("period", { ascending: false })
        .limit(1000),
      supabase.from("maintenance_requests").select("id, rental_id, status").limit(1000),
      supabase
        .from("properties")
        .select("id, property_code, title")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("customers")
        .select("id, full_name, phone")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const rentals = rentalData ?? [];
  const charges = chargeData ?? [];
  const maints = maintData ?? [];

  /*
   * Seçici havuzları "son eklenen 100" kısayolu. Ön dolgu havuz dışında
   * kalırsa sessizce düşerdi — eksik kayıtlar tek sorguyla listeye eklenir.
   */
  const dialogProperties = [...(propData ?? [])];
  const dialogCustomers = [...(custData ?? [])];
  if (prefillPropertyId && !dialogProperties.some((p) => p.id === prefillPropertyId)) {
    const { data: extra } = await supabase
      .from("properties")
      .select("id, property_code, title")
      .eq("id", prefillPropertyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) dialogProperties.unshift(extra);
  }
  if (prefillCustomerId && !dialogCustomers.some((c) => c.id === prefillCustomerId)) {
    const { data: extra } = await supabase
      .from("customers")
      .select("id, full_name, phone")
      .eq("id", prefillCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (extra) dialogCustomers.unshift(extra);
  }
  const validPrefillProperty =
    prefillPropertyId && dialogProperties.some((p) => p.id === prefillPropertyId) ? prefillPropertyId : null;
  const validPrefillCustomer =
    prefillCustomerId && dialogCustomers.some((c) => c.id === prefillCustomerId) ? prefillCustomerId : null;
  const autoOpenRentalDialog = canCreate && Boolean(validPrefillProperty || validPrefillCustomer);

  const today = daysAgoIso(0).slice(0, 10);
  const curMonth = today.slice(0, 7);
  const curPeriodPrefix = `${curMonth}-01`;
  const in30 = daysFromNowIso(30).slice(0, 10);

  // Ay bazlı tahakkuk haritaları
  const curMonthByRental = new Map<string, (typeof charges)[number]>();
  const overdueRentals = new Set<string>();
  let paidSum = 0;
  let pendingSum = 0;
  let overdueCount = 0;
  for (const c of charges) {
    const period = String(c.period).slice(0, 10);
    if (period === curPeriodPrefix) {
      curMonthByRental.set(c.rental_id as string, c);
      if (c.status === "paid") paidSum += Number(c.amount);
      if (c.status === "pending") pendingSum += Number(c.amount);
    }
    if (c.status === "overdue") {
      overdueCount += 1;
      overdueRentals.add(c.rental_id as string);
    }
  }

  const openMaintRentals = new Set<string>();
  let openMaint = 0;
  for (const m of maints) {
    if (m.status !== "done") {
      openMaint += 1;
      openMaintRentals.add(m.rental_id as string);
    }
  }

  const activeCount = rentals.filter((r) => r.status === "active").length;

  // ---- Yenileme radarı: yıldönümü YA DA sözleşme bitişi 60 gün içinde ----
  const in60 = daysFromNowIso(60).slice(0, 10);
  const canEdit = perms.rentals?.includes("edit") ?? false;
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
      const increase = computeLegalIncrease(current, renewalDate.slice(0, 7));
      return [{ rental: r, renewalDate, current, increase }];
    })
    .sort((a, b) => (a.renewalDate < b.renewalDate ? -1 : 1));

  // ---- Sözleşme yaşam döngüsü: her kayıt tek evreye düşer (öncelik sıralı) ----
  const renewalIds = new Set(renewalRadar.map(({ rental }) => String(rental.id)));
  const yeni90 = daysAgoIso(90).slice(0, 10);
  const evreOf = (r: (typeof rentals)[number]): Evre => {
    if (r.status !== "active") return "bitti";
    if (r.end_date && r.end_date >= today && r.end_date <= in30) return "bitiyor";
    if (renewalIds.has(String(r.id))) return "yenileme";
    if (String(r.start_date) >= yeni90) return "yeni";
    return "devam";
  };
  const evreCounts: Record<Evre, number> = { yeni: 0, devam: 0, yenileme: 0, bitiyor: 0, bitti: 0 };
  for (const r of rentals) evreCounts[evreOf(r)] += 1;

  // Liste filtreleri — KPI kartlarının drill-down hedefleri
  const filtered = rentals.filter((r) => {
    if (evreF && evreOf(r) !== evreF) return false;
    if (arizaF && !openMaintRentals.has(r.id as string)) return false;
    if (durumF === "overdue") return overdueRentals.has(r.id as string);
    if (durumF === "paid") return curMonthByRental.get(r.id as string)?.status === "paid";
    if (durumF === "pending") return curMonthByRental.get(r.id as string)?.status === "pending";
    return true;
  });

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <KeyRound className="h-4 w-4" /> Mülk yönetimi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Kiralama</h1>
            <p className="mt-1 text-sm text-white/70">
              Kira sözleşmeleri, aylık tahakkuklar ve bakım talepleri tek yerde.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/app/kira-artis"
              className="focus-ring press rounded-[10px] border border-white/15 bg-white/8 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
            >
              Kira artış hesaplayıcı
            </Link>
            <ExportCsvButton
              label="Dışa aktar"
              action={exportRentalsCsv.bind(null, { durum: durumF, ariza: arizaF ? "acik" : "", evre: evreF })}
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-50"
            />
            {canCreate ? <NewRentalDialog
                /* Kazanılan kira anlaşması köprüsü: ?portfoy=&musteri=&tutar= */
                properties={dialogProperties}
                customers={dialogCustomers}
                defaultPropertyId={validPrefillProperty}
                defaultCustomerId={validPrefillCustomer}
                defaultMonthlyRent={prefillRent}
                autoOpen={autoOpenRentalDialog}
              /> : null}
          </div>
        </div>
      </section>

      {/* KPI'lar — hepsi tıklanınca listeyi süzer ("sıfır çıkmaz metrik") */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Aktif kira" value={activeCount} icon={KeyRound} href="/app/kiralama" />
        <StatCard label="Bu ay tahsilat" value={money(paidSum)} icon={Wallet} tone="success" href="/app/kiralama?durum=paid" />
        <StatCard label="Bu ay bekleyen" value={money(pendingSum)} icon={Hourglass} tone="warning" href="/app/kiralama?durum=pending" />
        <StatCard label="Geciken tahakkuk" value={overdueCount} icon={AlertTriangle} tone="danger" href="/app/kiralama?durum=overdue" />
        <StatCard label="Açık arıza" value={openMaint} icon={Wrench} tone={openMaint > 0 ? "warning" : "neutral"} href="/app/kiralama?ariza=acik" />
      </div>

      {/* Sözleşme yaşam döngüsü — portföyün evre dağılımı; her segment/çip listeyi süzer */}
      {rentals.length > 0 ? (
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
              <Activity className="h-4 w-4 text-brand-600" /> Sözleşme yaşam döngüsü
            </h2>
            <p className="text-xs text-text-muted">
              {rentals.length} sözleşme — imzadan yenilemeye, tüm evreler tek şeritte.
            </p>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-ink-950/6" role="img" aria-label="Sözleşme evre dağılımı">
            {EVRELER.map((e) =>
              evreCounts[e] > 0 ? (
                <div
                  key={e}
                  className={`h-full ${EVRE_META[e].bar} transition-all`}
                  style={{ width: `${(evreCounts[e] / rentals.length) * 100}%` }}
                  title={`${EVRE_META[e].label}: ${evreCounts[e]}`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {EVRELER.map((e) => (
              <Link
                key={e}
                href={evreF === e ? "/app/kiralama" : `/app/kiralama?evre=${e}`}
                aria-current={evreF === e ? "page" : undefined}
                className={`focus-ring press inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  evreF === e
                    ? "border-brand-400/50 bg-brand-600/10 text-brand-700"
                    : "border-line bg-canvas text-text-muted hover:border-brand-300 hover:text-brand-600"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${EVRE_META[e].dot}`} />
                {EVRE_META[e].label}
                <span className={`numeric font-bold ${EVRE_META[e].text}`}>{evreCounts[e]}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Yenileme radarı — yıldönümü/bitişi 60 gün içindeki aktif kiralar */}
      {renewalRadar.length > 0 ? (
        <section className="rounded-[18px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink-950">
              <CalendarClock className="h-4 w-4 text-brand-600" /> Yenileme radarı
              <span className="numeric rounded-full bg-brand-600/10 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                {renewalRadar.length}
              </span>
            </h2>
            <p className="text-xs text-text-muted">Önümüzdeki 60 gün — önerilen kira TÜFE tavanına göre hesaplanır (TBK m.344).</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {renewalRadar.map(({ rental: r, renewalDate, current, increase }) => {
              const prop = rel(r.property);
              const renter = rel(r.renter);
              const propName = prop?.title ?? prop?.property_code ?? "Portföy";
              return (
                <div key={r.id} className="flex flex-col gap-3 rounded-[14px] border border-line bg-canvas p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {prop ? (
                        <Link href={`/app/portfoyler/${prop.id}`} className="focus-ring block truncate rounded-[6px] text-sm font-bold text-ink-950 hover:text-brand-600 hover:underline">
                          {propName}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-bold text-ink-950">{propName}</p>
                      )}
                      {renter ? (
                        <Link href={`/app/musteriler/${renter.id}`} className="focus-ring rounded-[6px] text-xs text-text-muted hover:text-brand-600 hover:underline">
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
                    <div className="rounded-[10px] bg-surface p-2">
                      <p className="text-[10px] text-text-muted">Mevcut kira</p>
                      <p className="text-sm font-bold text-ink-950">{money(current)}</p>
                    </div>
                    <div className="rounded-[10px] bg-surface p-2">
                      <p className="text-[10px] text-text-muted">Yenileme</p>
                      <p className="text-sm font-bold text-ink-950">{dateLabel(renewalDate)}</p>
                    </div>
                    <div className="rounded-[10px] bg-surface p-2">
                      <p className="text-[10px] text-text-muted">Önerilen</p>
                      <p className="text-sm font-bold text-mint-600">{money(increase.newRent)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/app/kiralama/${r.id}`} className="focus-ring rounded-[6px] text-xs font-semibold text-brand-600 hover:underline">
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

      {/* Aktif filtre çipleri */}
      {durumF || arizaF || evreF ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Filtre:</span>
          {evreF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
              {EVRE_META[evreF].label}
              <Link href="/app/kiralama" aria-label="Evre filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          {durumF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
              {DURUM_LABELS[durumF]}
              <Link href={arizaF ? "/app/kiralama?ariza=acik" : "/app/kiralama"} aria-label="Durum filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          {arizaF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold text-amber-700">
              Açık arıza
              <Link href={durumF ? `/app/kiralama?durum=${durumF}` : "/app/kiralama"} aria-label="Arıza filtresini temizle" className="focus-ring rounded-full hover:text-amber-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          <span className="numeric text-xs text-text-faint">{filtered.length} kayıt</span>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={rentals.length === 0 ? "Henüz kira kaydı yok" : "Filtreye uyan kayıt yok"}
          description={
            rentals.length === 0
              ? "Portföyünüzdeki kiralık mülkleri kiracısıyla eşleştirip aylık tahakkukları buradan takip edin."
              : "Filtreyi temizleyip tüm kira kayıtlarını görüntüleyebilirsiniz."
          }
          tone="brand"
          action={
            rentals.length > 0
              ? { href: "/app/kiralama", label: "Filtreyi temizle" }
              : canCreate
                ? {
                    node: (
                      /* autoOpen YOK: üstteki örnek zaten ön dolgulu açılıyor,
                         ikisi birden açılırsa iki modal üst üste gelir. */
                      <NewRentalDialog
                        properties={dialogProperties}
                        customers={dialogCustomers}
                        defaultPropertyId={validPrefillProperty}
                        defaultCustomerId={validPrefillCustomer}
                        defaultMonthlyRent={prefillRent}
                      />
                    ),
                  }
                : undefined
          }
        />
      ) : (
        <TableFrame minWidth={860}>
          <Table>
            <THead>
              <TR>
                <TH>Portföy</TH>
                <TH>Kiracı</TH>
                <TH align="right">Aylık kira</TH>
                <TH>Sonraki vade</TH>
                <TH>Durum</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((r) => {
                const prop = rel(r.property);
                const renter = rel(r.renter);
                const cur = curMonthByRental.get(r.id as string);
                // Sonraki vade: bu ay ödenmişse gelecek ay, değilse bu ayın vadesi
                const dueMonth = cur?.status === "paid" ? nextMonthOf(curMonth) : curMonth;
                const nextDue = dueDateOf(dueMonth, Number(r.due_day));
                const duePast = r.status === "active" && nextDue < today;
                const active = r.status === "active";
                const endingSoon = active && r.end_date && r.end_date >= today && r.end_date <= in30;
                return (
                  <TR key={r.id} interactive>
                    <TD className="font-semibold text-ink-950">
                      {/* Satır örtü linki → kira detayına gider */}
                      <Link
                        href={`/app/kiralama/${r.id}`}
                        className="absolute inset-0"
                        aria-label={`${prop?.title ?? prop?.property_code ?? "Kira kaydı"} kira detayını aç`}
                      />
                      {prop ? (
                        <Link href={`/app/portfoyler/${prop.id}`} className="focus-ring relative z-10 rounded-[6px] hover:text-brand-600 hover:underline">
                          {prop.title ?? prop.property_code}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-text-muted">
                      {renter ? (
                        <Link href={`/app/musteriler/${renter.id}`} className="focus-ring relative z-10 rounded-[6px] font-semibold text-ink-950 hover:text-brand-600 hover:underline">
                          {renter.full_name ?? "İsimsiz"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD align="right" className="font-bold text-ink-950">{money(Number(r.monthly_rent))}</TD>
                    <TD className={duePast ? "font-semibold text-danger-600" : "text-text-muted"}>
                      {active ? dateLabel(nextDue) : "—"}
                    </TD>
                    <TD>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <Badge variant={active ? "success" : "outline"} size="sm">
                          {active ? "Aktif" : "Bitti"}
                        </Badge>
                        {endingSoon ? (
                          <Badge variant="warning" size="sm">Sözleşme bitiyor</Badge>
                        ) : null}
                        {overdueRentals.has(r.id as string) ? (
                          <Badge variant="danger" size="sm">Gecikme</Badge>
                        ) : null}
                        {openMaintRentals.has(r.id as string) ? (
                          <Badge variant="warning" size="sm">Arıza</Badge>
                        ) : null}
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </div>
  );
}
