import Link from "next/link";
import { Coins, TrendingUp, AlertTriangle, ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight, Gauge, X } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { msSince, now, DAY_MS } from "@/lib/clock";
import { DuesClient } from "./dues-client";

export const metadata = { title: "Aidat & Ortak Gider" };

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const DURUM_FILTERS = ["paid", "unpaid", "overdue"] as const;
type DurumFilter = (typeof DURUM_FILTERS)[number];

const DURUM_LABELS: Record<DurumFilter, string> = {
  paid: "Ödendi",
  unpaid: "Bekleyen",
  overdue: "Gecikmiş",
};

const DONEM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Sayfa başına aidat — gerçek sayfalama (300'lük dilim + bellek filtresi yerine). */
const PAGE_SIZE = 50;

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

/** ?donem=YYYY-MM için sonraki ayın ilk gününü döndürür (period aralığı için). */
function nextMonthFirst(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

type DueLite = {
  id: string;
  title: string;
  amount: number;
  period: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
};

export default async function AidatPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; donem?: string; sayfa?: string }>;
}) {
  const { perms, tenantId } = await requireModulePage("expenses");
  const params = (await searchParams) ?? {};
  const durumF = DURUM_FILTERS.includes(params.durum as DurumFilter) ? (params.durum as DurumFilter) : "";
  const donemF = DONEM_RE.test(params.donem ?? "") ? params.donem! : "";
  const canCreate = perms.expenses?.includes("create") ?? false;
  const canEdit = perms.expenses?.includes("edit") ?? false;
  const page = Math.max(1, Number.parseInt(params.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Mevcut filtreleri koruyan link üretici (sayfa taşınmaz — filtre değişince 1. sayfaya döner)
  const href = (next: { durum?: string | null; donem?: string | null }) =>
    `/app/aidat${qs({
      durum: next.durum === undefined ? durumF || null : next.durum,
      donem: next.donem === undefined ? donemF || null : next.donem,
    })}`;

  // Sayfalama linki — mevcut filtreleri korur, yalnız ?sayfa değişir.
  const pageHref = (n: number) =>
    `/app/aidat${qs({ durum: durumF || null, donem: donemF || null, sayfa: n > 1 ? String(n) : null })}`;

  const supabase = await createClient();
  // Overdue = ödenmemiş + vadesi bugün ya da öncesi (isPast(due_date) semantiği).
  const todayStr = new Date(now()).toISOString().slice(0, 10);

  // ---- Sayfalanan liste: filtreler DB sorgusuna iner (eskiden 300 dilim +
  //      bellek filtresi → 300'ü aşan ofiste ?durum/?donem "kayıt yok" diyordu).
  let listQuery = supabase
    .from("property_dues")
    .select("id, title, amount, period, due_date, status, notes, property:properties(id, property_code, title)", { count: "exact" });
  if (tenantId) listQuery = listQuery.eq("tenant_id", tenantId);
  if (donemF) listQuery = listQuery.gte("period", `${donemF}-01`).lt("period", nextMonthFirst(donemF));
  if (durumF === "paid") listQuery = listQuery.eq("status", "paid");
  else if (durumF === "unpaid") listQuery = listQuery.neq("status", "paid");
  else if (durumF === "overdue") listQuery = listQuery.neq("status", "paid").lte("due_date", todayStr);
  listQuery = listQuery
    .order("period", { ascending: false })
    .order("due_date", { ascending: true, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // ---- KPI toplamları: DB'de TAM SUM (aidat_kpi RPC) — önceki 2000-satır havuz
  //      yaklaşıktı ve büyük ofiste eksik sayardı. Geciken ŞERİDİ için ayrı odaklı
  //      sorgu (en yakın vadeli ilk 20 geciken); tüm havuzu çekmeye gerek yok.
  const overdueStripQuery = supabase
    .from("property_dues")
    .select("id, title, amount, period, due_date, status, property:properties(id, property_code, title)")
    .neq("status", "paid")
    .lte("due_date", todayStr)
    .order("due_date", { ascending: true })
    .limit(20);

  const [{ data: listData, count: listCount }, kpiRes, { data: overdueStripData }, { data: propData }] = await Promise.all([
    listQuery,
    supabase.rpc("aidat_kpi"),
    overdueStripQuery,
    supabase
      .from("properties")
      .select("id, property_code, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const filteredDues = (listData ?? []) as unknown as DueLite[];
  const properties = (propData ?? []).map((p) => ({ id: p.id as string, property_code: p.property_code as string, title: p.title as string | null }));

  // KPI'lar tüm kayıtlar üzerinden (RPC, filtreden bağımsız); ?durum=/?donem= listeyi süzer.
  const kpi = ((Array.isArray(kpiRes.data) ? kpiRes.data[0] : kpiRes.data) ?? {}) as {
    total?: number; unpaid?: number; overdue_count?: number; overdue_total?: number;
  };
  const total = Number(kpi.total ?? 0);
  const unpaid = Number(kpi.unpaid ?? 0);
  const paidAmount = total - unpaid;
  // Tahsilat oranı — ödenen tutarın toplam tahakkuka oranı (tutar bazlı)
  const collectionRate = total > 0 ? Math.round((paidAmount / total) * 100) : 0;
  const overdue = Number(kpi.overdue_count ?? 0);
  const overdueTotal = Number(kpi.overdue_total ?? 0);
  const overdueDues = (overdueStripData ?? []) as unknown as DueLite[];

  // Sayfalama toplamları — count filtreye (durum/dönem) duyarlı gerçek toplam.
  const totalFiltered = listCount ?? filteredDues.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const rangeStart = totalFiltered === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + filteredDues.length, totalFiltered);

  const donemLabel = donemF
    ? new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(`${donemF}-01T00:00:00`))
    : "";

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-amber-400/20 blur-[70px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-amber-300"><Coins className="h-4 w-4" /> Aidat & ortak gider</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Aidat takibi</h1>
            <p className="mt-1 text-sm text-white/70">Portföy bazlı aidat/ortak gider ve ödeme durumu tek yerde.</p>
          </div>
          {/* KPI kartları ?durum= filtresine bağlı: tıklayınca liste süzülür (dönem korunur) */}
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-4">
            <Link
              href={href({ durum: "paid" })}
              aria-current={durumF === "paid" ? "page" : undefined}
              className={`focus-ring press lift group block rounded-[14px] border p-3 text-center transition hover:border-white/30 ${
                durumF === "paid" ? "border-white/35 bg-white/12" : "border-white/12 bg-white/8"
              }`}
            >
              <Gauge className="mx-auto h-4 w-4 text-mint-400" />
              <p className="mt-1 flex items-center justify-center gap-1 font-display text-lg font-extrabold text-white">
                %{collectionRate}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/60">Tahsilat oranı</p>
              {/* Mini ilerleme çubuğu — tutar bazlı tahsilat */}
              <div className="mx-auto mt-1.5 h-1 w-full max-w-[72px] overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-mint-400" style={{ width: `${collectionRate}%` }} />
              </div>
            </Link>
            <Link
              href={href({ durum: null })}
              className={`focus-ring press lift group block rounded-[14px] border p-3 text-center transition hover:border-white/30 ${
                durumF === "" ? "border-white/35 bg-white/12" : "border-white/12 bg-white/8"
              }`}
            >
              <TrendingUp className="mx-auto h-4 w-4 text-cyan-400" />
              <p className="mt-1 flex items-center justify-center gap-1 font-display text-lg font-extrabold text-white">
                {money(total)}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/60">Toplam</p>
            </Link>
            <Link
              href={href({ durum: "unpaid" })}
              aria-current={durumF === "unpaid" ? "page" : undefined}
              className={`focus-ring press lift group block rounded-[14px] border p-3 text-center transition hover:border-white/30 ${
                durumF === "unpaid" ? "border-white/35 bg-white/12" : "border-white/12 bg-white/8"
              }`}
            >
              <Coins className="mx-auto h-4 w-4 text-amber-300" />
              <p className="mt-1 flex items-center justify-center gap-1 font-display text-lg font-extrabold text-white">
                {money(unpaid)}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/60">Bekleyen</p>
            </Link>
            <Link
              href={href({ durum: "overdue" })}
              aria-current={durumF === "overdue" ? "page" : undefined}
              className={`focus-ring press lift group block rounded-[14px] border p-3 text-center transition hover:border-white/30 ${
                durumF === "overdue" ? "border-white/35 bg-white/12" : "border-white/12 bg-white/8"
              }`}
            >
              <AlertTriangle className="mx-auto h-4 w-4 text-danger-400" />
              <p className="mt-1 flex items-center justify-center gap-1 font-display text-lg font-extrabold text-white">
                {overdue}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/60">Gecikmiş</p>
            </Link>
          </div>
        </div>
      </section>

      {/* Geciken ödemeler şeridi — vadesi geçmiş kayıtlar, en eski vade önce.
          Kart portföye (varsa) gider; başlık linki listeyi ?durum=overdue süzer. */}
      {overdue > 0 ? (
        <section className="overflow-hidden rounded-[18px] border border-danger-500/25 bg-danger-50/60 shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger-500/15 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-danger-600">
              <AlertTriangle className="h-4 w-4" /> Geciken ödemeler
              <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-[11px] font-bold text-danger-600">
                {overdue} kayıt · {money(overdueTotal)}
              </span>
            </p>
            <Link
              href={href({ durum: "overdue" })}
              className="focus-ring inline-flex items-center gap-1 rounded-[8px] text-xs font-semibold text-danger-600 transition hover:text-danger-700 hover:underline"
            >
              Tümünü listede gör <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 py-3">
            {overdueDues.slice(0, 8).map((d) => {
              const prop = Array.isArray(d.property) ? d.property[0] : d.property;
              const gecikmeGun = d.due_date ? Math.max(1, Math.floor(msSince(`${d.due_date}T00:00:00`) / DAY_MS)) : 0;
              const target = prop?.id ? `/app/portfoyler/${prop.id}` : href({ durum: "overdue" });
              return (
                <Link
                  key={d.id}
                  href={target}
                  className="focus-ring press lift group block min-w-[210px] shrink-0 rounded-[14px] border border-danger-500/20 bg-surface p-3 transition hover:border-danger-500/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink-950">{d.title}</p>
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:text-danger-500 group-hover:opacity-100" />
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">
                    {prop ? (prop.title ?? prop.property_code) : "Portföysüz kayıt"}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="numeric font-display text-sm font-extrabold text-ink-950">{money(Number(d.amount))}</span>
                    <span className="rounded-full bg-danger-500/10 px-2 py-0.5 text-[10px] font-bold text-danger-600">
                      {gecikmeGun} gün gecikti
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Dönem (ay) filtresi — GET formu (?donem=YYYY-MM); ?durum= korunur */}
      <form action="/app/aidat" className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        {durumF ? <input type="hidden" name="durum" value={durumF} /> : null}
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Dönem:</span>
        <input
          name="donem"
          type="month"
          defaultValue={donemF}
          aria-label="Dönem (ay) filtresi"
          className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
        />
        <button type="submit" className="rounded-[9px] bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-700">
          Filtrele
        </button>
        {donemF ? (
          <Link href={href({ donem: null })} className="text-[11px] font-semibold text-text-muted hover:text-danger-500">
            Dönemi temizle
          </Link>
        ) : null}
      </form>

      {/* Aktif filtre çipleri */}
      {durumF || donemF ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Filtre:</span>
          {durumF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
              {DURUM_LABELS[durumF]}
              <Link href={href({ durum: null })} aria-label="Durum filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          {donemF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
              {donemLabel}
              <Link href={href({ donem: null })} aria-label="Dönem filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          <span className="numeric text-xs text-text-faint">{totalFiltered.toLocaleString("tr-TR")} kayıt</span>
        </div>
      ) : null}

      <DuesClient dues={filteredDues as Parameters<typeof DuesClient>[0]["dues"]} properties={properties} canCreate={canCreate} canBulk={canEdit} />

      {/* Sayfalama — filtre parametreleri linklerde korunur */}
      {totalFiltered > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="numeric text-text-muted">
            {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
            {totalFiltered.toLocaleString("tr-TR")}
          </p>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className={PAGER_BTN}>
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
              <Link href={pageHref(page + 1)} className={PAGER_BTN}>
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
    </div>
  );
}
