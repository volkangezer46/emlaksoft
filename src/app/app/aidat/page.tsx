import Link from "next/link";
import { Coins, TrendingUp, AlertTriangle, ArrowUpRight, CalendarRange, X } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
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
  const now = new Date();
  const isOverdue = (d: (typeof dues)[number]) => d.status !== "paid" && d.due_date != null && new Date(d.due_date) < now;
  const total = dues.reduce((s, d) => s + Number(d.amount), 0);
  const unpaid = dues.filter((d) => d.status !== "paid").reduce((s, d) => s + Number(d.amount), 0);
  const overdue = dues.filter(isOverdue).length;

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
          <div className="grid grid-cols-3 gap-3">
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
