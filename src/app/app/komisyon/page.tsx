import {
  ArrowUpRight,
  Banknote,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { now as nowMs } from "@/lib/clock";
import { requireModulePage } from "@/lib/require-module-page";
import { ChartFrame } from "@/app/app/_ui/lazy-chart";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { exportCommissionsCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { CommissionSimulator } from "./commission-simulator";
import { CommissionActions } from "./commission-actions";
import { CommissionSplitEditor } from "./commission-split-editor";
import { BulkCollectBar, BulkCollectCheckbox, BulkCollectProvider } from "./bulk-collect";

type CommissionRow = {
  id: string;
  gross_amount: number;
  vat_amount: number;
  status: string;
  splits: { label?: string; amount?: number; rate?: number }[] | null;
  created_at: string;
  deal_id: string | null;
  deal: {
    id: string;
    deal_value: number | null;
    stage: string;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  } | {
    id: string;
    deal_value: number | null;
    stage: string;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  }[] | null;
};

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

function dealOf(value: CommissionRow["deal"]) {
  return Array.isArray(value) ? value[0] : value;
}

/** ?durum= değerleri: bekleyen = tahsil edilmemiş, tahsil = paid/collected. */
const DURUM_FILTERS = ["bekleyen", "tahsil"] as const;
type DurumFilter = (typeof DURUM_FILTERS)[number];

const PAGE_SIZE = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `to` günü dahil olsun diye timestamptz karşılaştırmasında ertesi gün (hariç) kullanılır. */
function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export default async function CommissionPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; from?: string; to?: string; sayfa?: string }>;
}) {
  const { perms } = await requireModulePage("commissions");
  const canEdit = (perms.commissions ?? []).includes("edit");
  const params = (await searchParams) ?? {};
  const durum: DurumFilter | null = DURUM_FILTERS.includes(params.durum as DurumFilter)
    ? (params.durum as DurumFilter)
    : null;
  const from = ISO_DATE.test(params.from ?? "") ? params.from! : null;
  const to = ISO_DATE.test(params.to ?? "") ? params.to! : null;
  const sayfa = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);

  // Hızlı tarih çipleri — sunucu saatine göre hesaplanır
  const now = new Date(nowMs());
  const presets = [
    { label: "Bu ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmtDate(now) },
    { label: "Geçen ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)) },
    { label: "Son 3 ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: fmtDate(now) },
  ];

  const supabase = await createClient();
  const savedViews = await listSavedViews("/app/komisyon");
  // Onay merkezi rozeti — tek head-count sorgusu (bkz. /app/onaylar).
  const bekleyenOnay = (await supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "bekliyor")).count ?? 0;
  // Kayıtlı görünümler için aktif filtre paramları (sayfa hariç)
  const savedViewParams: Record<string, string> = {};
  if (durum) savedViewParams.durum = durum;
  if (from) savedViewParams.from = from;
  if (to) savedViewParams.to = to;
  let ledgerQuery = supabase
    .from("commissions")
    .select(
      "id, gross_amount, vat_amount, status, splits, created_at, deal_id, deal:deals(id,deal_value,stage,property:properties(id,property_code,title))",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((sayfa - 1) * PAGE_SIZE, sayfa * PAGE_SIZE - 1);
  if (durum === "tahsil") ledgerQuery = ledgerQuery.in("status", ["paid", "collected"]);
  else if (durum === "bekleyen") ledgerQuery = ledgerQuery.not("status", "in", "(paid,collected)");
  if (from) ledgerQuery = ledgerQuery.gte("created_at", from);
  if (to) ledgerQuery = ledgerQuery.lt("created_at", nextDay(to));

  const [{ data, count: commissionTotal }, { data: statRows }, { data: memberRows }] = await Promise.all([
    ledgerQuery,
    // KPI toplamları filtreden ve sayfalamadan bağımsız — splits/created_at
    // danışman dağılımı ve dönem KPI'ları için okunur.
    // .order eklendi: sırasız limit(1000) sayfa yüklemeleri arasında farklı 1000
    // satır döndürüp KPI toplamlarını oynatıyordu (non-deterministik). En güncel
    // 1000 tutarlı okunur. (Not: 1000+ komisyonlu ofiste toplam eksik sayar —
    // tam doğruluk için ileride SUM RPC'si.)
    supabase.from("commissions").select("gross_amount, status, splits, created_at").order("created_at", { ascending: false }).limit(1000),
    // Split etiketini danışman profiline bağlamak için ad → id eşlemesi
    supabase.from("profiles").select("id, full_name").eq("is_active", true),
  ]);

  const rows = (data ?? []) as CommissionRow[];
  const stats = (statRows ?? []) as {
    gross_amount: number;
    status: string;
    splits: { label?: string; amount?: number; rate?: number }[] | null;
    created_at: string;
  }[];
  const statPaid = (s: { status: string }) => s.status === "paid" || s.status === "collected";
  const total = stats.reduce((sum, row) => sum + Number(row.gross_amount), 0);
  const paid = stats.filter(statPaid).reduce((sum, row) => sum + Number(row.gross_amount), 0);
  const pending = total - paid;

  // Dönem (bu ay) KPI şeridi — filtrelerden bağımsız, ayın 1'inden bugüne
  const donemLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(now);
  const donemStats = stats.filter((r) => String(r.created_at).slice(0, 10) >= presets[0].from);
  const donemToplam = donemStats.reduce((s, r) => s + Number(r.gross_amount), 0);
  const donemTahsil = donemStats.filter(statPaid).reduce((s, r) => s + Number(r.gross_amount), 0);
  const donemBekleyen = donemToplam - donemTahsil;

  // Danışman bazlı dağılım — split etiketlerine göre pay (brüt × oran)
  const advisorTotals = new Map<string, { pay: number; adet: number }>();
  for (const r of stats) {
    const splits = Array.isArray(r.splits) ? r.splits : [];
    for (const s of splits) {
      const label = (s.label ?? "").trim();
      const rate = Number(s.rate) || 0;
      if (!label || rate <= 0) continue;
      const entry = advisorTotals.get(label) ?? { pay: 0, adet: 0 };
      entry.pay += Math.round(Number(r.gross_amount) * (rate / 100));
      entry.adet += 1;
      advisorTotals.set(label, entry);
    }
  }
  const advisorDist = Array.from(advisorTotals, ([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.pay - a.pay)
    .slice(0, 8);
  const advisorMax = Math.max(1, ...advisorDist.map((a) => a.pay));

  // Beklenen vs tahsil edilen — son 6 ay, çift seri (tahakkuk / tahsilat)
  const kpiAyFmt = new Intl.DateTimeFormat("tr-TR", { month: "short" });
  const aylikSeri = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: kpiAyFmt.format(d),
      value: 0,
      value2: 0,
    };
  });
  const seriIndex = new Map(aylikSeri.map((m, i) => [m.key, i]));
  for (const r of stats) {
    const idx = seriIndex.get(String(r.created_at).slice(0, 7));
    if (idx === undefined) continue;
    aylikSeri[idx].value += Number(r.gross_amount);
    if (statPaid(r)) aylikSeri[idx].value2 += Number(r.gross_amount);
  }
  const hasAylikSeri = aylikSeri.some((m) => m.value > 0);

  const totalCount = commissionTotal ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Sayfa dışındaki paramları koruyarak link üretir; sayfa değişince filtreler kalır
  const pageHref = (p: number) => `/app/komisyon${qs({ durum: durum ?? undefined, from, to, sayfa: p > 1 ? String(p) : undefined })}`;
  // Filtre değişince sayfa 1'e döner (sayfa paramı atılır)
  const filterHref = (next: { durum?: DurumFilter | null; from?: string | null; to?: string | null }) =>
    `/app/komisyon${qs({
      durum: (next.durum === undefined ? durum : next.durum) ?? undefined,
      from: next.from === undefined ? from : next.from,
      to: next.to === undefined ? to : next.to,
    })}`;

  // Toplu tahsil için bu sayfadaki bekleyen kayıtlar
  const pendingIds = rows
    .filter((r) => r.status !== "paid" && r.status !== "collected")
    .map((r) => r.id);

  /*
   * Split satırları serbest metin etiket taşır ({label, rate}); danışman id'si
   * YOK. Etiket bir ekip üyesinin adıyla birebir eşleşiyorsa profiline link
   * verilir — eşleşmeyen etiketler (Ofis, Referans…) düz metin kalır.
   */
  const memberIdByName = new Map(
    (memberRows ?? []).map((m) => [m.full_name as string, m.id as string]),
  );

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-amber-400/20 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-amber-400"><Banknote className="h-4 w-4" /> Finans merkezi</span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Komisyon & hakediş</h1>
          <p className="mt-1 text-sm text-white/60">Çok taraflı paylaşım, KDV ve tahsilat görünümü tek defterde.</p>
          <Link href="/app/onaylar?durum=bekliyor" className="focus-ring press mt-3 inline-flex items-center gap-1.5 rounded-[10px] border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/30 hover:text-white">Onaylar{bekleyenOnay > 0 ? <span className="numeric rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[10px] font-bold text-ink-950">{bekleyenOnay}</span> : null}<ArrowUpRight className="h-3.5 w-3.5 opacity-60" /></Link>
        </div>
        <div className="relative mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* KPI kartları defter filtresine bağlı: tıklayınca ?durum= uygulanır (tarih aralığı korunur) */}
          {[
            { label: "Toplam komisyon", value: money(total), icon: Wallet, tone: "text-cyan-400", href: filterHref({ durum: null }), active: durum === null },
            { label: "Tahsil edilen", value: money(paid), icon: CheckCircle2, tone: "text-mint-400", href: filterHref({ durum: "tahsil" }), active: durum === "tahsil" },
            { label: "Bekleyen", value: money(pending), icon: Clock3, tone: "text-amber-400", href: filterHref({ durum: "bekleyen" }), active: durum === "bekleyen" },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`focus-ring press lift group block rounded-[14px] border p-3 backdrop-blur transition hover:border-brand-300 ${
                item.active ? "border-white/35 bg-white/12" : "border-white/10 bg-white/5"
              }`}
            >
              <div className="flex items-start justify-between">
                <item.icon className={`h-4 w-4 ${item.tone}`} />
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </div>
              <p className="mt-2 truncate font-display text-lg font-extrabold text-white md:text-xl">{item.value}</p>
              <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Dönem KPI şeridi — bu ayın tahakkuk/tahsilat özeti; kartlar defteri
          ilgili tarih aralığı + durumla süzer (?from/?to/?durum). */}
      <section className="rounded-[18px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-text-faint">
          <CalendarRange className="h-3.5 w-3.5 text-brand-600" /> Dönem özeti · {donemLabel}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Dönem komisyonu", value: money(donemToplam), href: filterHref({ durum: null, from: presets[0].from, to: presets[0].to }), tone: "text-ink-950" },
            { label: "Tahsil edilen", value: money(donemTahsil), href: filterHref({ durum: "tahsil", from: presets[0].from, to: presets[0].to }), tone: "text-mint-600" },
            { label: "Bekleyen", value: money(donemBekleyen), href: filterHref({ durum: "bekleyen", from: presets[0].from, to: presets[0].to }), tone: "text-amber-600" },
            { label: "Kayıt", value: donemStats.length.toLocaleString("tr-TR"), href: filterHref({ durum: null, from: presets[0].from, to: presets[0].to }), tone: "text-brand-600" },
          ].map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="focus-ring press lift group block rounded-[14px] border border-line bg-canvas/50 p-3 transition hover:border-brand-300"
            >
              <p className="flex items-center gap-1 text-[11px] font-semibold text-text-muted">
                {k.label}
                <ArrowUpRight className="hover-action h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </p>
              <p className={`numeric mt-1 truncate font-display text-lg font-extrabold ${k.tone}`}>{k.value}</p>
            </Link>
          ))}
        </div>
        {/* Dönem tahsilat oranı çubuğu */}
        {donemToplam > 0 ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] font-semibold text-text-muted">
              <span>Dönem tahsilat oranı</span>
              <span className="numeric text-mint-600">%{Math.round((donemTahsil / donemToplam) * 100)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div className="h-full rounded-full bg-mint-500" style={{ width: `${Math.round((donemTahsil / donemToplam) * 100)}%` }} />
            </div>
          </div>
        ) : null}
      </section>

      {/* Danışman bazlı dağılım + beklenen vs tahsil edilen trend */}
      {advisorDist.length > 0 || hasAylikSeri ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {advisorDist.length > 0 ? (
            <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Wallet className="h-4 w-4" /> Paylaşım analizi</p>
              <h2 className="mt-1 font-display font-bold text-ink-950">Danışman bazlı dağılım</h2>
              <p className="mt-0.5 text-[11px] text-text-muted">Split oranlarından hesaplanan pay toplamları — tüm defter</p>
              <ul className="mt-4 space-y-3">
                {advisorDist.map((a) => {
                  const memberId = memberIdByName.get(a.label);
                  return (
                    <li key={a.label}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        {memberId ? (
                          <Link href={`/app/ekip/${memberId}`} className="focus-ring rounded-[4px] font-semibold text-brand-600 hover:underline">
                            {a.label}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink-950">{a.label}</span>
                        )}
                        <span className="numeric font-display text-sm font-bold text-ink-950">{money(a.pay)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                          <div
                            className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]"
                            style={{ width: `${Math.max(3, Math.round((a.pay / advisorMax) * 100))}%` }}
                          />
                        </div>
                        <span className="numeric w-14 shrink-0 text-right text-[11px] font-semibold text-text-muted">{a.adet} kayıt</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {hasAylikSeri ? (
            <ChartFrame
              title="Beklenen vs tahsil edilen"
              subtitle="Son 6 ay · tahakkuk eden brüt komisyon ve tahsilatı"
              height={advisorDist.length > 0 ? 300 : 260}
            >
              <InteractiveChart
                data={aylikSeri.map((m) => ({ label: m.label, value: Math.round(m.value), value2: Math.round(m.value2) }))}
                name="Tahakkuk"
                name2="Tahsil edilen"
                color="var(--brand-600)"
                color2="var(--mint-500)"
                diffLabel="Bekleyen"
                format="money"
                height={210}
              />
            </ChartFrame>
          ) : null}
        </div>
      ) : null}

      <CommissionSimulator />

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div><p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><ReceiptText className="h-4 w-4" /> Gerçek kayıtlar</p><h2 className="mt-1 font-display font-bold text-ink-950">Komisyon defteri</h2></div>
          <div className="flex items-center gap-2">
            <ExportCsvButton action={exportCommissionsCsv} label="Dışa aktar" />
            <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">{totalCount} kayıt</span>
          </div>
        </div>
        {/* Durum filtre çipleri — sunucu filtresi (?durum=), tarih aralığı korunur */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          {[
            { value: null, label: "Tümü" },
            { value: "bekleyen" as const, label: "Bekleyen" },
            { value: "tahsil" as const, label: "Tahsil edilen" },
          ].map((f) => (
            <Link
              key={f.label}
              href={filterHref({ durum: f.value })}
              className={`rounded-[10px] border px-3.5 py-1.5 text-xs font-semibold transition ${
                durum === f.value
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-ink-950 hover:border-brand-300"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        {/* Tarih aralığı — GET formu (?from=&to=) + hızlı seçim çipleri; ?durum= korunur */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Tarih:</span>
          {presets.map((p) => {
            const active = from === p.from && to === p.to;
            return (
              <Link
                key={p.label}
                href={filterHref({ from: p.from, to: p.to })}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                  active
                    ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                    : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
          <form action="/app/komisyon" className="flex flex-wrap items-center gap-2">
            {durum ? <input type="hidden" name="durum" value={durum} /> : null}
            <input
              name="from"
              type="date"
              defaultValue={from ?? ""}
              aria-label="Başlangıç tarihi"
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
            />
            <span className="text-xs text-text-faint">—</span>
            <input
              name="to"
              type="date"
              defaultValue={to ?? ""}
              aria-label="Bitiş tarihi"
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
            />
            <button type="submit" className="rounded-[9px] bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-700">
              Filtrele
            </button>
            {from || to ? (
              <Link href={filterHref({ from: null, to: null })} className="text-[11px] font-semibold text-text-muted hover:text-danger-500">
                Tarihi temizle
              </Link>
            ) : null}
          </form>
        </div>
        {/* Kayıtlı görünümler — aktif filtre kombinasyonu adlandırılıp saklanır */}
        <SavedViews
          route="/app/komisyon"
          views={savedViews}
          currentParams={savedViewParams}
          className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3"
        />
        {/* key: sayfa/filtre değişince seçim sıfırlanır — önceki sayfadan
            kalan bayat id'ler "tahsil edildi" işaretlenmesin */}
        <BulkCollectProvider key={`${durum ?? ""}|${from ?? ""}|${to ?? ""}|${sayfa}`}>
          {canEdit ? <BulkCollectBar allIds={pendingIds} /> : null}
          {rows.length === 0 ? (
            <div className="grid place-items-center px-6 py-14 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-amber-400/12 text-amber-500"><Wallet className="h-7 w-7" /></span>
              <h3 className="mt-4 font-display text-lg font-bold text-ink-950">
                {durum || from || to || sayfa > 1
                  ? "Bu filtrelerle eşleşen komisyon kaydı yok"
                  : "Henüz komisyon kaydı yok"}
              </h3>
              <p className="mt-1 max-w-md text-sm text-text-muted">Kapanan anlaşmalardan oluşan komisyon ve hakediş kayıtları burada izlenecek.</p>
              {durum || from || to || sayfa > 1 ? (
                <Link href="/app/komisyon" className="mt-3 text-sm font-semibold text-brand-600 hover:underline">
                  Filtreleri temizle
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-line">
              {rows.map((row) => {
                const deal = dealOf(row.deal);
                const property = deal ? (Array.isArray(deal.property) ? deal.property[0] : deal.property) : null;
                const rowPaid = row.status === "paid" || row.status === "collected";
                return (
                  <article
                    key={row.id}
                    className={`group relative grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] md:items-center ${
                      canEdit ? "md:grid-cols-[auto_1.4fr_.7fr_.7fr_auto]" : "md:grid-cols-[1.4fr_.7fr_.7fr_auto]"
                    }`}
                  >
                    {/* Örtü link: portföylü kayıt portföye, portföysüz kayıt bağlı
                        anlaşmaya gider — para satırı çıkmaz sokak olmasın. */}
                    {property?.id ? (
                      <Link href={`/app/portfoyler/${property.id}`} className="absolute inset-0" aria-label={`${property.title ?? property.property_code ?? "Komisyon"} portföyü`} />
                    ) : row.deal_id ? (
                      <Link href={`/app/anlasmalar/${row.deal_id}`} className="absolute inset-0" aria-label="Bağlı anlaşmayı aç" />
                    ) : null}
                    {canEdit ? (
                      <div className="relative z-10 flex items-center">
                        {!rowPaid ? (
                          <BulkCollectCheckbox id={row.id} label={`${property?.title ?? "Komisyon kaydı"} seç`} />
                        ) : (
                          <span className="inline-block h-4 w-4" aria-hidden />
                        )}
                      </div>
                    ) : null}
                    <div><p className="text-sm font-semibold text-ink-950">{property?.title ?? "Komisyon kaydı"}</p><p className="mt-0.5 text-xs text-text-muted">{property?.property_code ?? (row.deal_id ? "Portföysüz anlaşma" : "Genel işlem")} · {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(row.created_at))}</p></div>
                    <div>
                      <p className="text-[11px] text-text-faint">Brüt komisyon</p>
                      <p className="font-display text-sm font-bold text-ink-950">{money(Number(row.gross_amount))}</p>
                      {Array.isArray(row.splits) && row.splits.length > 0 ? (
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-text-muted">
                          {row.splits.map((s, i) => {
                            const memberId = s.label ? memberIdByName.get(s.label) : undefined;
                            return (
                              <span key={i}>
                                {memberId ? (
                                  <Link
                                    href={`/app/ekip/${memberId}`}
                                    className="focus-ring relative z-10 rounded-[4px] font-semibold text-brand-600 hover:underline"
                                  >
                                    {s.label}
                                  </Link>
                                ) : (
                                  s.label
                                )}
                                {" "}%{s.rate}{i < row.splits!.length - 1 ? " ·" : ""}
                              </span>
                            );
                          })}
                        </p>
                      ) : null}
                    </div>
                    <div><span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${rowPaid ? "bg-mint-500/10 text-mint-600" : "bg-amber-400/15 text-amber-500"}`}>{rowPaid ? "Tahsil edildi" : "Hesaplandı"}</span></div>
                    {canEdit ? (
                      <div className="relative z-10 flex flex-col items-end gap-1.5">
                        <CommissionSplitEditor commissionId={row.id} gross={Number(row.gross_amount)} initial={row.splits} />
                        <CommissionActions commissionId={row.id} amount={Number(row.gross_amount)} status={row.status} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </BulkCollectProvider>
        {/* Sayfalama — ?sayfa=, filtreler korunur */}
        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <span className="numeric text-[11px] font-medium text-text-muted">
              Sayfa {sayfa} / {totalPages} · toplam {totalCount.toLocaleString("tr-TR")} kayıt
            </span>
            <div className="flex items-center gap-2">
              {sayfa > 1 ? (
                <Link href={pageHref(sayfa - 1)} className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300">
                  <ChevronLeft className="h-3.5 w-3.5" /> Önceki
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
                  <ChevronLeft className="h-3.5 w-3.5" /> Önceki
                </span>
              )}
              {sayfa < totalPages ? (
                <Link href={pageHref(sayfa + 1)} className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300">
                  Sonraki <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
                  Sonraki <ChevronRight className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
          </nav>
        ) : null}
        <div className="flex items-center gap-2 border-t border-line bg-canvas/60 px-5 py-3 text-[11px] font-semibold text-mint-600"><TrendingUp className="h-3.5 w-3.5" /> Tüm hesaplamalar denetim iziyle saklanır</div>
      </section>
    </div>
  );
}
