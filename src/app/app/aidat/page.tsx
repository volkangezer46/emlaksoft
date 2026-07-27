import Link from "next/link";
import { Coins, TrendingUp, AlertTriangle, ArrowUpRight, CalendarRange, Gauge, X } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { DAY_MS, isPast, msSince } from "@/lib/clock";
import { listDues } from "@/app/actions/dues";
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

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function AidatPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; donem?: string }>;
}) {
  const { perms } = await requireModulePage("expenses");
  const params = (await searchParams) ?? {};
  const durumF = DURUM_FILTERS.includes(params.durum as DurumFilter) ? (params.durum as DurumFilter) : "";
  const donemF = DONEM_RE.test(params.donem ?? "") ? params.donem! : "";
  const canCreate = perms.expenses?.includes("create") ?? false;
  const canEdit = perms.expenses?.includes("edit") ?? false;

  // Mevcut filtreleri koruyan link üretici
  const href = (next: { durum?: string | null; donem?: string | null }) =>
    `/app/aidat${qs({
      durum: next.durum === undefined ? durumF || null : next.durum,
      donem: next.donem === undefined ? donemF || null : next.donem,
    })}`;

  const supabase = await createClient();
  const [dues, { data: propData }] = await Promise.all([
    listDues(),
    supabase
      .from("properties")
      .select("id, property_code, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const properties = (propData ?? []).map((p) => ({ id: p.id as string, property_code: p.property_code as string, title: p.title as string | null }));

  // KPI'lar her zaman tüm kayıtlar üzerinden; ?durum= ve ?donem= yalnızca listeyi süzer
  const isOverdue = (d: (typeof dues)[number]) => d.status !== "paid" && isPast(d.due_date);
  const total = dues.reduce((s, d) => s + Number(d.amount), 0);
  const unpaid = dues.filter((d) => d.status !== "paid").reduce((s, d) => s + Number(d.amount), 0);
  const paidAmount = total - unpaid;
  // Tahsilat oranı — ödenen tutarın toplam tahakkuka oranı (tutar bazlı)
  const collectionRate = total > 0 ? Math.round((paidAmount / total) * 100) : 0;
  const overdueDues = dues
    .filter(isOverdue)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const overdue = overdueDues.length;
  const overdueTotal = overdueDues.reduce((s, d) => s + Number(d.amount), 0);

  // Dönem (ay) filtresi — period tarih kolonu, YYYY-MM öneki eşleştirilir
  const periodDues = donemF ? dues.filter((d) => String(d.period ?? "").slice(0, 7) === donemF) : dues;
  const filteredDues =
    durumF === "paid"
      ? periodDues.filter((d) => d.status === "paid")
      : durumF === "unpaid"
        ? periodDues.filter((d) => d.status !== "paid")
        : durumF === "overdue"
          ? periodDues.filter(isOverdue)
          : periodDues;

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
          <span className="numeric text-xs text-text-faint">{filteredDues.length} kayıt</span>
        </div>
      ) : null}

      <DuesClient dues={filteredDues as Parameters<typeof DuesClient>[0]["dues"]} properties={properties} canCreate={canCreate} canBulk={canEdit} />
    </div>
  );
}
