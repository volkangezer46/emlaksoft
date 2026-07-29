import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Radar,
  ShieldAlert,
  Siren,
  TrendingDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { moneyTry } from "@/lib/leak-shield";
import { InteractiveChart } from "@/components/app/interactive-chart";
import type { CSSProperties } from "react";
import { now } from "@/lib/clock";

const RING_C = 2 * Math.PI * 42;

type Closure = {
  id: string;
  reason: string;
  deal_happened: boolean | null;
  deal_amount: number | null;
  closed_by_us: boolean | null;
  competitor_closed: boolean | null;
  estimated_lost_commission: number | null;
  created_at: string;
  portal_listing: {
    portal_name: string;
    portal_listing_id: string | null;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  } | {
    portal_name: string;
    portal_listing_id: string | null;
    property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  }[] | null;
};

function listingOf(c: Closure) {
  return Array.isArray(c.portal_listing) ? c.portal_listing[0] : c.portal_listing;
}
function propertyOf(c: Closure) {
  const listing = listingOf(c);
  const p = listing?.property;
  return Array.isArray(p) ? p[0] : p;
}

function daysSince(value: string | null, ref: number) {
  if (!value) return 999;
  return Math.floor((ref - new Date(value).getTime()) / 86_400_000);
}

const TIP_FILTERS = ["rakip", "bizim", "islem"] as const;
type TipFilter = (typeof TIP_FILTERS)[number];

const TIP_LABELS: Record<TipFilter, string> = {
  rakip: "Rakip kapanış",
  bizim: "Bizim kapanış",
  islem: "İşlem var",
};

const PAGE_SIZE = 50;

/** Kapanış kaydı select'i — hem aggregate havuzda hem sayfalı listede aynı kolonlar. */
const CLOSURE_SELECT =
  "id, reason, deal_happened, deal_amount, closed_by_us, competitor_closed, estimated_lost_commission, created_at, portal_listing:portal_listings(portal_name, portal_listing_id, property:properties(id, property_code, title))";

/** YYYY-MM-DD biçimindeyse döndür, aksi halde boş — sorguya ham girdi gitmesin. */
function safeDate(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

export default async function LeakShieldPage({
  searchParams,
}: {
  searchParams?: Promise<{ neden?: string; tip?: string; from?: string; to?: string; sayfa?: string }>;
}) {
  await requireModulePage("leak");
  const params = (await searchParams) ?? {};
  const nedenF = (params.neden ?? "").trim();
  const tipF = TIP_FILTERS.includes(params.tip as TipFilter) ? (params.tip as TipFilter) : "";
  const fromF = safeDate(params.from);
  const toF = safeDate(params.to);
  const rangeActive = Boolean(fromF || toF);
  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const pageParam = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;

  // ?from=&to= sunucu tarafında uygulanır. AGGREGATE HAVUZ: KPI, 8-hafta trendi,
  // neden dağılımı ve kaçak oranı bu 500'lük pencereden hesaplanır (para
  // toplamları PostgREST'te head-count edilemez; RPC eklenmedi).
  let closuresQuery = supabase
    .from("listing_closures")
    .select(CLOSURE_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);
  if (fromF) closuresQuery = closuresQuery.gte("created_at", fromF);
  if (toF) closuresQuery = closuresQuery.lte("created_at", `${toF}T23:59:59.999`);

  // KAPANIŞ LİSTESİ: neden/tip/tarih filtreleri SORGUYA iner + gerçek .range()
  // sayfalama + count:"exact". Eskiden 500'lük havuz bellekte süzülüp
  // dilimleniyordu → 500'ü aşan ofiste filtre sessizce eksik sonuç veriyordu.
  let listQuery = supabase
    .from("listing_closures")
    .select(CLOSURE_SELECT, { count: "exact" })
    .order("created_at", { ascending: false });
  if (fromF) listQuery = listQuery.gte("created_at", fromF);
  if (toF) listQuery = listQuery.lte("created_at", `${toF}T23:59:59.999`);
  if (nedenF) listQuery = listQuery.eq("reason", nedenF);
  if (tipF === "rakip") listQuery = listQuery.eq("competitor_closed", true);
  else if (tipF === "bizim") listQuery = listQuery.eq("closed_by_us", true);
  else if (tipF === "islem") listQuery = listQuery.eq("deal_happened", true);

  // Tarih aralığındaki toplam kapanış (neden/tip'ten bağımsız) — "X / Y" başlığı.
  let totalQuery = supabase.from("listing_closures").select("id", { count: "exact", head: true });
  if (fromF) totalQuery = totalQuery.gte("created_at", fromF);
  if (toF) totalQuery = totalQuery.lte("created_at", `${toF}T23:59:59.999`);

  const [
    { data: closures },
    { data: listings },
    { data: listData, count: listTotal },
    { count: totalClosures },
  ] = await Promise.all([
    closuresQuery,
    supabase
      .from("portal_listings")
      // property id: teyit gecikmiş ilan kartlarından portföy detayına gidiş için
      .select("id, portal_name, portal_listing_id, status, last_confirmed_at, property:properties(id, property_code, title)")
      .eq("status", "live")
      .limit(200),
    listQuery.range(offset, offset + PAGE_SIZE - 1),
    totalQuery,
  ]);

  const pageRows = (listData ?? []) as Closure[];
  const listCount = listTotal ?? 0;
  const totalClosuresCount = totalClosures ?? 0;

  const nowMs = now();
  const rows = (closures ?? []) as Closure[];
  const live = listings ?? [];
  const overdue = live.filter((r) => daysSince(r.last_confirmed_at, nowMs) >= 7);

  // ── Teyit SLA şeridi: canlı ilanların son teyit yaşına göre dağılımı ──────
  // Taze ≤ 3 gün · Yaklaşan 4–6 gün · Gecikmiş ≥ 7 gün (portal teyit SLA'sı).
  const slaFresh = live.filter((r) => daysSince(r.last_confirmed_at, nowMs) <= 3).length;
  const slaDue = live.filter((r) => {
    const d = daysSince(r.last_confirmed_at, nowMs);
    return d >= 4 && d <= 6;
  }).length;
  const slaOverdue = overdue.length;
  const slaTotal = live.length;
  const slaHealth = slaTotal > 0 ? Math.round(((slaFresh + slaDue) / slaTotal) * 100) : null;

  // Risk sıralaması: en uzun süredir teyitsiz canlı ilanlar (en riskli önce)
  const riskRanking = [...overdue]
    .sort((a, b) => daysSince(b.last_confirmed_at, nowMs) - daysSince(a.last_confirmed_at, nowMs))
    .slice(0, 8);
  const maxOverdueDays = Math.max(7, ...riskRanking.map((r) => Math.min(daysSince(r.last_confirmed_at, nowMs), 60)));

  const monthRows = rows.filter((r) => new Date(r.created_at) >= monthStart);
  const lostMonth = monthRows.reduce((s, r) => s + Number(r.estimated_lost_commission || 0), 0);
  const lostAll = rows.reduce((s, r) => s + Number(r.estimated_lost_commission || 0), 0);
  const competitor = rows.filter((r) => r.competitor_closed).length;
  const ours = rows.filter((r) => r.closed_by_us).length;
  const leakRows = rows.filter((r) => Number(r.estimated_lost_commission || 0) > 0);

  // 8-week lost commission buckets
  const weekMs = 7 * 86_400_000;
  const buckets = Array.from({ length: 8 }, () => 0);
  rows.forEach((r) => {
    const idx = 7 - Math.floor((nowMs - new Date(r.created_at).getTime()) / weekMs);
    if (idx >= 0 && idx < 8) buckets[idx] += Number(r.estimated_lost_commission || 0);
  });
  // Hafta etiketi: kovanın başladığı günün kısa tarihi (etkileşimli grafik + tooltip)
  const weekFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
  const trendWeeks = buckets.map((b, i) => ({
    label: weekFmt.format(new Date(nowMs - (7 - i) * weekMs)),
    value: b,
  }));

  const reasonCounts = new Map<string, number>();
  rows.forEach((r) => reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1));
  const reasonBars = [...reasonCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxReason = Math.max(1, ...reasonBars.map((r) => r.count));

  const leakShare = rows.length ? leakRows.length / rows.length : 0;

  const hasFilter = Boolean(nedenF || tipF || rangeActive);

  // ?sayfa= — kapanış listesi sunucuda 50'şer sayfalanır (count:"exact"); filtre
  // linkleri sayfayı sıfırlar. pageRows/listCount yukarıdaki sorgudan gelir.
  const totalPages = Math.max(1, Math.ceil(listCount / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);

  /** Mevcut filtreyi koruyarak tek parametreyi değiştiren link üretici (sayfa sıfırlanır). */
  const filterHref = (over: { neden?: string | null; tip?: string | null; from?: string | null; to?: string | null; sayfa?: number }) => {
    const sp = new URLSearchParams();
    const neden = over.neden === undefined ? nedenF : (over.neden ?? "");
    const tip = over.tip === undefined ? tipF : (over.tip ?? "");
    const from = over.from === undefined ? fromF : (over.from ?? "");
    const to = over.to === undefined ? toF : (over.to ?? "");
    if (neden) sp.set("neden", neden);
    if (tip) sp.set("tip", tip);
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    if (over.sayfa && over.sayfa > 1) sp.set("sayfa", String(over.sayfa));
    const qs = sp.toString();
    return qs ? `/app/kayip-kacak?${qs}#kapanislar` : "/app/kayip-kacak#kapanislar";
  };

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-danger-500/25 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-danger-400">
              <span className="status-pulse h-2 w-2 rounded-full bg-danger-400" /> Leak Shield · Kayıp-kaçak
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Kaçan komisyon motoru</h1>
            <p className="mt-1 max-w-lg text-sm text-white/60">
              Portal kapanışlarından otomatik hesaplanan tahmini kayıp. Rakip / ofis dışı işlemler burada görünür.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                // Tarih aralığı seçiliyken KPI'lar o aralıktan hesaplanır
                rangeActive
                  ? { label: "Aralıkta kayıp", value: moneyTry(lostAll), tone: "text-danger-400", href: filterHref({}) }
                  : { label: "Bu ay kayıp", value: moneyTry(lostMonth), tone: "text-danger-400", href: "/app/kayip-kacak#kapanislar" },
                rangeActive
                  ? { label: "Aralıkta kapanış", value: String(totalClosuresCount), tone: "", href: filterHref({}) }
                  : { label: "Toplam kayıp", value: moneyTry(lostAll), tone: "", href: "/app/kayip-kacak#kapanislar" },
                { label: "Rakip kapanış", value: String(competitor), tone: "text-amber-300", href: filterHref({ tip: "rakip" }) },
                { label: "Teyit gecikmiş", value: String(overdue.length), tone: "text-warn-500", href: "/app/portallar?durum=teyit" },
              ].map((k) => (
                <Link
                  key={k.label}
                  href={k.href}
                  className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 hover:border-white/30"
                >
                  <p className={`flex items-center gap-1 font-display text-lg font-extrabold ${k.tone}`}>
                    {k.value}
                    <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
                  </p>
                  <p className="text-[11px] text-white/45">{k.label}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75">
                <TrendingDown className="h-3.5 w-3.5 text-danger-400" /> Kayıp trend · 8 hafta
              </p>
              <span className="rounded-full bg-danger-500/15 px-2 py-0.5 text-[11px] font-bold text-danger-300">
                {moneyTry(buckets[7] ?? 0)}
              </span>
            </div>
            {/* Etkileşimli 8 hafta trendi — crosshair + haftalık kayıp tooltip'i */}
            <InteractiveChart
              className="mt-3"
              data={trendWeeks}
              name="Kayıp"
              color="var(--danger-500)"
              format="money"
              height={96}
              labelEvery={2}
            />
          </div>
        </div>
      </section>

      {/* ── Teyit SLA durumu şeridi ─────────────────────────────────────────── */}
      {slaTotal > 0 ? (
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                <ShieldAlert className="h-4 w-4" /> Teyit SLA durumu
              </p>
              <h2 className="mt-1 font-display font-bold text-ink-950">
                {slaTotal} canlı ilan
                {slaHealth !== null ? (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    slaHealth >= 85 ? "bg-mint-500/12 text-mint-600" : slaHealth >= 60 ? "bg-amber-400/15 text-amber-600" : "bg-danger-500/10 text-danger-500"
                  }`}>
                    %{slaHealth} SLA içinde
                  </span>
                ) : null}
              </h2>
            </div>
            <p className="text-[11px] text-text-faint">SLA: her ilan en geç 7 günde bir teyit edilir</p>
          </div>

          {/* Oransal şerit — segmentler tıklanabilir chips ile eşleşir */}
          <div className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Taze ${slaFresh}, yaklaşan ${slaDue}, gecikmiş ${slaOverdue} ilan`}>
            {slaFresh > 0 ? <div className="bar-live h-full rounded-full bg-mint-500" style={{ width: `${(slaFresh / slaTotal) * 100}%` }} /> : null}
            {slaDue > 0 ? <div className="bar-live h-full rounded-full bg-amber-400" style={{ width: `${(slaDue / slaTotal) * 100}%`, animationDelay: "0.08s" }} /> : null}
            {slaOverdue > 0 ? <div className="bar-live h-full rounded-full bg-danger-500" style={{ width: `${(slaOverdue / slaTotal) * 100}%`, animationDelay: "0.16s" }} /> : null}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { label: "Taze · son 3 gün", value: slaFresh, dot: "bg-mint-500", text: "text-mint-600", href: "/app/portallar?durum=live" },
              { label: "Yaklaşan · 4–6 gün", value: slaDue, dot: "bg-amber-400", text: "text-amber-600", href: "/app/portallar?durum=live" },
              { label: "Gecikmiş · 7+ gün", value: slaOverdue, dot: "bg-danger-500", text: "text-danger-500", href: "/app/portallar?durum=teyit" },
            ].map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="focus-ring press lift group flex min-h-[44px] items-center justify-between gap-2 rounded-[12px] border border-line bg-canvas/50 px-3.5 py-2.5 hover:border-brand-300"
              >
                <span className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
                </span>
                <span className={`flex items-center gap-1 font-display text-lg font-extrabold ${s.text}`}>
                  {s.value}
                  <ArrowUpRight className="h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:opacity-100" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-danger-500">
            <Siren className="h-4 w-4" /> Kaçak oranı
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Kapanış kalitesi</h2>
          <div className="mt-5 flex items-center gap-4">
            <div className="relative grid h-28 w-28 place-items-center">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="10" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--danger-500)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - leakShare) } as CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-lg font-extrabold text-ink-950">%{Math.round(leakShare * 100)}</p>
                <p className="text-[10px] text-text-faint">kaçak</p>
              </div>
            </div>
            <div className="space-y-2 text-xs text-text-muted">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint-500" /> {ours} bizim kapanış</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-danger-500" /> {competitor} rakip</div>
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400" /> {rows.length} toplam kayıt</div>
            </div>
          </div>
        </section>

        <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-600">
            <ShieldAlert className="h-4 w-4" /> Neden dağılımı
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Kapanış sebepleri</h2>
          {reasonBars.length === 0 ? (
            <p className="mt-6 text-sm text-text-muted">Henüz kapanış kaydı yok. Portal Kontrol’den ilan kapatınca burada görünür.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {reasonBars.map((r, i) => {
                const active = nedenF === r.label;
                return (
                  <Link
                    key={r.label}
                    // Aktif nedene tekrar tıklamak filtreyi kaldırır
                    href={filterHref({ neden: active ? null : r.label })}
                    aria-current={active ? "page" : undefined}
                    className={`focus-ring group block rounded-[10px] p-1 -m-1 ${active ? "bg-brand-600/5" : ""}`}
                  >
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="flex items-center gap-1 font-semibold text-ink-950">
                        {r.label}
                        <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                      </span>
                      <span className="tabular-nums text-text-muted">{r.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-canvas">
                      <div
                        className="bar-live h-full rounded-full bg-[image:var(--grad-brand)]"
                        style={{ width: `${(r.count / maxReason) * 100}%`, animationDelay: `${i * 0.08}s` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {riskRanking.length > 0 ? (
        <section className="rounded-[20px] border border-warn-500/30 bg-warn-500/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warn-500" />
              <div>
                <h2 className="font-display font-bold text-ink-950">Risk sıralaması — teyit gecikmiş ilanlar</h2>
                <p className="text-xs text-text-muted">
                  En uzun süredir teyitsiz kalan {riskRanking.length} ilan · teyitsiz her gün kaçak riskini büyütür
                </p>
              </div>
            </div>
            <Link href="/app/portallar?durum=teyit" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              Tümü Portal Kontrol&apos;de <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {riskRanking.map((r, i) => {
              const prop = Array.isArray(r.property) ? r.property[0] : r.property;
              const days = daysSince(r.last_confirmed_at, nowMs);
              const sev = Math.min(days, 60) / maxOverdueDays;
              const critical = days >= 21;
              const inner = (
                <div className="flex w-full items-center gap-3">
                  {/* Sıra rozeti */}
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-sm font-extrabold ${
                      i === 0 ? "bg-danger-500 text-white" : critical ? "bg-danger-500/12 text-danger-500" : "bg-warn-500/15 text-warn-600"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-sm font-semibold text-ink-950">
                      {r.portal_name} {r.portal_listing_id ? `#${r.portal_listing_id}` : ""}
                      {prop?.id ? (
                        <ArrowUpRight className="hover-action h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {prop?.property_code ?? "—"}{prop?.title ? ` · ${prop.title}` : ""}
                    </p>
                    {/* Aciliyet çubuğu — gün sayısı sıralamadaki en yükseğe oranlanır */}
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas">
                      <div
                        className={`bar-live h-full rounded-full ${critical ? "bg-danger-500" : "bg-warn-500"}`}
                        style={{ width: `${Math.max(8, sev * 100)}%`, animationDelay: `${i * 0.06}s` }}
                      />
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums ${
                    critical ? "bg-danger-500/10 text-danger-500" : "bg-warn-500/15 text-warn-600"
                  }`}>
                    {days >= 999 ? "Hiç teyit yok" : `${days} gün`}
                  </span>
                </div>
              );
              return prop?.id ? (
                <Link
                  key={r.id}
                  href={`/app/portfoyler/${prop.id}`}
                  className="focus-ring press group flex min-h-[44px] rounded-[14px] border border-line bg-surface px-3.5 py-2.5 transition hover:border-brand-300"
                >
                  {inner}
                </Link>
              ) : (
                <div key={r.id} className="group flex min-h-[44px] rounded-[14px] border border-line bg-surface px-3.5 py-2.5">
                  {inner}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section id="kapanislar" className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Radar className="h-4 w-4 text-danger-500" /> Kapanış kayıtları
            </h2>
            <p className="text-xs text-text-muted">
              {hasFilter ? `${listCount} / ${totalClosuresCount} kayıt` : `${totalClosuresCount} kayıt`}
              {totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""} · tahmini kayıp otomatik hesaplanır
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {nedenF ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-[11px] font-semibold text-brand-700">
                Neden: {nedenF}
                <Link href={filterHref({ neden: null })} aria-label="Neden filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                  ×
                </Link>
              </span>
            ) : null}
            {tipF ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-[11px] font-semibold text-brand-700">
                {TIP_LABELS[tipF]}
                <Link href={filterHref({ tip: null })} aria-label="Tip filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                  ×
                </Link>
              </span>
            ) : null}
            <Link href="/app/portallar" className="text-xs font-semibold text-brand-600">Portal Kontrol</Link>
          </div>
        </div>
        {/* ?from=&to= — tarih aralığı GET formu; neden/tip gizli alanlarla korunur */}
        <form method="get" action="/app/kayip-kacak" className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-3">
          {nedenF ? <input type="hidden" name="neden" value={nedenF} /> : null}
          {tipF ? <input type="hidden" name="tip" value={tipF} /> : null}
          <span className="text-xs font-medium text-text-muted">Kapanış tarihi:</span>
          <input
            name="from"
            type="date"
            defaultValue={fromF}
            aria-label="Başlangıç tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <span className="text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF}
            aria-label="Bitiş tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <button type="submit" className="focus-ring press rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
            Uygula
          </button>
          {rangeActive ? (
            <Link href={filterHref({ from: null, to: null })} className="text-xs font-semibold text-text-muted underline-offset-2 hover:text-danger-500 hover:underline">
              Aralığı temizle
            </Link>
          ) : null}
        </form>
        {totalClosuresCount === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-text-muted">
            Henüz kapanış yok. Yayından kalkan ilanı “Kapat” ile kaydedin — kayıp-kaçak burada oluşur.
          </p>
        ) : listCount === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-text-muted">
            Filtreye uyan kapanış yok.{" "}
            <Link href="/app/kayip-kacak#kapanislar" className="font-semibold text-brand-600 hover:underline">
              Filtreleri temizle
            </Link>
          </p>
        ) : (
          <div className="divide-y divide-line">
            {pageRows.map((r) => {
              const listing = listingOf(r);
              const prop = propertyOf(r);
              const lost = Number(r.estimated_lost_commission || 0);
              return (
                <article key={r.id} className="group relative grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] sm:grid-cols-[1.4fr_.8fr_.7fr] sm:items-center">
                  {prop?.id ? (
                    <Link href={`/app/portfoyler/${prop.id}`} className="absolute inset-0" aria-label={`${prop.property_code ?? "Portföy"} kaydını aç`} />
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold text-ink-950">
                      {listing?.portal_name ?? "Portal"}{" "}
                      {listing?.portal_listing_id ? `#${listing.portal_listing_id}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {prop?.property_code ?? "—"} · {prop?.title ?? "Portföy"} · {r.reason}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {/* Rozetler filtre linki — relative z-10: satır overlay linkinin üstünde */}
                    {r.competitor_closed ? (
                      <Link
                        href={filterHref({ tip: tipF === "rakip" ? null : "rakip" })}
                        className="focus-ring press relative z-10 rounded-full bg-danger-500/10 px-2.5 py-1 text-[11px] font-bold text-danger-500 hover:bg-danger-500/20"
                      >
                        Rakip
                      </Link>
                    ) : null}
                    {r.closed_by_us ? (
                      <Link
                        href={filterHref({ tip: tipF === "bizim" ? null : "bizim" })}
                        className="focus-ring press relative z-10 rounded-full bg-mint-500/12 px-2.5 py-1 text-[11px] font-bold text-mint-600 hover:bg-mint-500/25"
                      >
                        Bizim
                      </Link>
                    ) : null}
                    {r.deal_happened ? (
                      <Link
                        href={filterHref({ tip: tipF === "islem" ? null : "islem" })}
                        className="focus-ring press relative z-10 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 hover:bg-brand-600/20"
                      >
                        İşlem var
                      </Link>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className={`font-display text-base font-extrabold ${lost > 0 ? "text-danger-500" : "text-mint-600"}`}>
                      {lost > 0 ? `−${moneyTry(lost)}` : "Kayıp yok"}
                    </p>
                    <p className="text-[11px] text-text-faint">
                      {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(r.created_at))}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link href={filterHref({ sayfa: page - 1 })} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                ← Önceki
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">Sayfa {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={filterHref({ sayfa: page + 1 })} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                Sonraki →
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
