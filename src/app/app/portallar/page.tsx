import Link from "next/link";
import { daysAgoIso } from "@/lib/clock";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RadioTower,
  ShieldCheck,
  Siren,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { exportPortalListingsCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { ClosePortalDialog, NewPortalDialog } from "./portal-dialogs";
import { ConfirmListingButton } from "./confirm-listing-button";
import { BulkConfirmForm } from "./bulk-confirm-form";
import { EmptyState } from "@/components/app/empty-state";

type PortalRow = {
  id: string;
  portal_name: string;
  portal_listing_id: string | null;
  portal_url: string | null;
  status: string;
  last_confirmed_at: string | null;
  published_at: string | null;
  removed_at: string | null;
  removal_reason: string | null;
  property: {
    id: string;
    property_code: string;
    title: string | null;
    list_price: number | null;
  } | {
    id: string;
    property_code: string;
    title: string | null;
    list_price: number | null;
  }[] | null;
};

const RING_C = 2 * Math.PI * 42;

// ?durum= kontratı: live | teyit | kapali
const DURUM_FILTERS = [
  { label: "Tümü", value: "" },
  { label: "Yayında", value: "live" },
  { label: "Teyit bekleyen", value: "teyit" },
  { label: "Kapanan", value: "kapali" },
] as const;

const DURUM_VALUES = ["live", "teyit", "kapali"] as const;

function propertyOf(value: PortalRow["property"]) {
  return Array.isArray(value) ? value[0] : value;
}

function daysSince(value: string | null) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

function relativeConfirm(value: string | null) {
  if (!value) return "Hiç teyit edilmedi";
  const days = daysSince(value);
  if (days === 0) return "Bugün teyit edildi";
  if (days === 1) return "Dün teyit edildi";
  return `${days} gün önce teyit edildi`;
}

// Filtre linkleri sayfa numarasını sıfırlar (sayfa parametresi yalnızca
// sayfalama linklerinde taşınır) — filtre değişince 1. sayfadan başlanır.
function portalHref(durum: string, portal: string, sayfa?: number, property?: string) {
  const sp = new URLSearchParams();
  if (durum) sp.set("durum", durum);
  if (portal) sp.set("portal", portal);
  if (sayfa && sayfa > 1) sp.set("sayfa", String(sayfa));
  if (property) sp.set("property", property);
  const qs = sp.toString();
  return qs ? `/app/portallar?${qs}` : "/app/portallar";
}

const PAGE_SIZE = 50;
/** Portal dağılımı barları için taranan azami kayıt (tek kolon, hafif). */
const DIST_LIMIT = 2000;

export default async function PortalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; portal?: string; sayfa?: string; property?: string }>;
}) {
  await requireModulePage("portals");
  const sp = (await searchParams) ?? {};
  const durum = (DURUM_VALUES as readonly string[]).includes(sp.durum ?? "") ? sp.durum! : "";
  const portal = sp.portal ?? "";
  const propertyF = sp.property ?? "";
  const supabase = await createClient();

  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  /*
   * BULUNAN HATA (sessiz veri kaybı): eskiden 500 kayıt çekilip durum/portal/
   * portföy BELLEKTE (array.filter) eleniyor, sayfalama da bellekte dilimleniyordu.
   * 500'ü aşan ofiste filtre yalnız ilk 500 kayıtta çalışıp kullanıcıya
   * yanlışlıkla "eşleşen yok" diyordu; ötesi hiç görünmüyordu.
   *
   * ÇÖZÜM: tüm filtreler Supabase sorgusunda + gerçek sayfalama (range + count).
   * "Teyit bekleyen" = canlı ve 7+ gündür teyitsiz; eşiği clock.ts'ten iso.
   */
  const overdueCutoff = daysAgoIso(7);
  const OVERDUE_OR = `last_confirmed_at.is.null,last_confirmed_at.lt."${overdueCutoff}"`;

  const LIST_COLS =
    "id, portal_name, portal_listing_id, portal_url, status, last_confirmed_at, published_at, removed_at, removal_reason, property:properties(id,property_code,title,list_price)";

  // Aynı filtre seti hem sayfalı listeye hem gerçek-toplam sayımına uygulanır.
  const buildFilteredQuery = (select: string, opts?: { count: "exact"; head?: boolean }) => {
    let query = supabase.from("portal_listings").select(select, opts);
    if (durum === "live") query = query.eq("status", "live");
    else if (durum === "teyit") query = query.eq("status", "live").or(OVERDUE_OR);
    else if (durum === "kapali") query = query.eq("status", "removed");
    if (portal) query = query.eq("portal_name", portal);
    if (propertyF) query = query.eq("property_id", propertyF);
    return query;
  };

  const [
    { data: listings, count: visibleTotal },
    { count: total },
    { count: liveTotal },
    { count: overdueTotal },
    { count: removedTotal },
    { data: distRows },
    { data: properties },
  ] = await Promise.all([
    buildFilteredQuery(LIST_COLS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1),
    // KPI/dağılım — liste artık sayfalı olduğundan head-count'larla gerçek toplamlar.
    supabase.from("portal_listings").select("id", { count: "exact", head: true }),
    supabase.from("portal_listings").select("id", { count: "exact", head: true }).eq("status", "live"),
    supabase.from("portal_listings").select("id", { count: "exact", head: true }).eq("status", "live").or(OVERDUE_OR),
    supabase.from("portal_listings").select("id", { count: "exact", head: true }).eq("status", "removed"),
    // Portal dağılımı — hafif tek kolon (portal_name); bellekte tally edilir.
    supabase.from("portal_listings").select("portal_name").limit(DIST_LIMIT),
    supabase
      .from("properties")
      .select("id, property_code, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const pageRows = (listings ?? []) as unknown as PortalRow[];
  const propertyOptions = properties ?? [];

  const totalCount = total ?? 0;
  const live = liveTotal ?? 0;
  const overdue = overdueTotal ?? 0;
  const removed = removedTotal ?? 0;

  const totalFiltered = visibleTotal ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const liveOnPage = pageRows.filter((row) => row.status === "live").length;

  const propertyChip = propertyF ? propertyOptions.find((p) => p.id === propertyF) ?? null : null;

  const onTime = Math.max(0, live - overdue);
  const healthRate = live ? onTime / live : 0;
  const portalCounts = new Map<string, number>();
  ((distRows ?? []) as { portal_name: string }[]).forEach((row) =>
    portalCounts.set(row.portal_name, (portalCounts.get(row.portal_name) ?? 0) + 1),
  );
  const portalStats = [...portalCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxCount = Math.max(1, ...portalStats.map((p) => p.count));
  const activeFilter = Boolean(durum || portal || propertyF);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-cyan-400/20 blur-[80px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><span className="status-pulse h-2 w-2 rounded-full bg-mint-400" /> Yayın ağı izleniyor</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Portal kontrol merkezi</h1>
            <p className="mt-1 text-sm text-white/60">Teyit, kapanış ve kayıp-kaçak sinyalleri tek operasyon akışında.</p>
            <Link href="/app/kayip-kacak" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-300 hover:text-amber-200">
              Kayıp-kaçak panosu <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <ExportCsvButton
              action={exportPortalListingsCsv}
              label="Dışa aktar"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-50"
            />
            <NewPortalDialog properties={propertyOptions} />
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-3">
          {[
            { label: "Canlı ilan", value: live, icon: RadioTower, tone: "text-mint-400", durum: "live" },
            { label: "Teyit bekleyen", value: overdue, icon: Clock3, tone: "text-amber-400", durum: "teyit" },
            { label: "Kapanan", value: removed, icon: Siren, tone: "text-danger-500", durum: "kapali" },
          ].map((item) => (
            <Link
              key={item.label}
              href={portalHref(item.durum, portal, undefined, propertyF)}
              className={`focus-ring press group relative block rounded-[14px] border bg-white/5 p-3 backdrop-blur transition hover:border-white/30 ${
                durum === item.durum ? "border-white/40" : "border-white/10"
              }`}
            >
              <ArrowUpRight className="hover-action absolute right-2 top-2 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
              <item.icon className={`h-4 w-4 ${item.tone}`} />
              <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
              <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {totalCount > 0 ? (
        <section className="grid items-center gap-5 rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] md:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-4 md:border-r md:border-line md:pr-6">
            <div className="relative grid h-24 w-24 place-items-center">
              <div className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md" style={{ background: "conic-gradient(from 0deg, var(--mint-500), var(--brand-500), var(--mint-500))" }} />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="9" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--mint-500)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - healthRate) } as React.CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-lg font-extrabold tabular-nums text-ink-950">%{Math.round(healthRate * 100)}</p>
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-bold text-ink-950"><ShieldCheck className="h-4 w-4 text-mint-600" /> Teyit sağlığı</p>
              <p className="mt-0.5 text-xs text-text-muted">{onTime}/{live} ilan zamanında teyitli</p>
              <Link
                href={portalHref("teyit", portal, undefined, propertyF)}
                className="focus-ring mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:underline"
              >
                {overdue} ilan 7+ gündür teyit bekliyor <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-950"><RadioTower className="h-3.5 w-3.5 text-brand-600" /> Portal dağılımı</p>
            <div className="mt-3 flex h-24 items-end gap-4">
              {portalStats.map((p, i) => (
                /* Bar tıklanınca liste o portala süzülür; aktif portala
                   tekrar tıklamak filtreyi kaldırır. */
                <Link
                  key={p.name}
                  href={portalHref(durum, portal === p.name ? "" : p.name, undefined, propertyF)}
                  aria-label={`${p.name} ilanlarını listele`}
                  className={`focus-ring group flex h-full flex-1 flex-col items-center gap-1.5 rounded-[8px] px-1 pt-1 transition hover:bg-brand-600/[0.04] ${
                    portal === p.name ? "bg-brand-600/[0.06]" : ""
                  }`}
                >
                  <span className="text-[11px] font-bold tabular-nums text-ink-950">{p.count}</span>
                  <div className="flex h-full w-full items-end justify-center">
                    <div
                      className="bar-live w-7 rounded-t-[5px] bg-[image:var(--grad-brand)] shadow-[0_0_12px_-2px_rgba(20,99,255,0.5)]"
                      style={{ height: `${(p.count / maxCount) * 100}%`, animationDelay: `${i * 0.1}s` }}
                    />
                  </div>
                  <span className={`max-w-[72px] truncate text-[10px] transition group-hover:text-brand-600 ${portal === p.name ? "font-bold text-brand-600" : "text-text-muted"}`}>
                    {p.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {propertyOptions.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-amber-400/30 bg-amber-400/8 px-5 py-4">
          <div className="flex items-center gap-3"><AlertTriangle className="h-5 w-5 text-amber-500" /><div><p className="text-sm font-semibold text-ink-950">Önce bir portföy oluşturun</p><p className="text-xs text-text-muted">Portal ilanı bağlamak için aktif bir portföy gerekir.</p></div></div>
          <Link href="/app/portfoyler" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">Portföylere git <ArrowUpRight className="h-4 w-4" /></Link>
        </div>
      ) : null}

      {totalCount === 0 ? (
        <EmptyState
          icon={RadioTower}
          title="Yayın ağınızı bağlayın"
          description="Portal ilanlarını portföylerle eşleştirin; teyit süresi ve kapanış nedenleri otomatik izlenmeye başlasın."
          tone="brand"
          action={
            propertyOptions.length > 0
              ? { label: "Yeni portal ilanı", node: <div className="[&>button]:bg-brand-600 [&>button]:text-white"><NewPortalDialog properties={propertyOptions} /></div> }
              : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display font-bold text-ink-950">Bağlı portal ilanları</h2>
              <p className="text-xs text-text-muted">
                {totalFiltered.toLocaleString("tr-TR")} yayın kaydı{activeFilter ? ` · ${totalCount.toLocaleString("tr-TR")} içinden` : ""}
                {totalPages > 1 ? ` · sayfa ${Math.min(page, totalPages)}/${totalPages}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {DURUM_FILTERS.map((f) => (
                <Link
                  key={f.value}
                  href={portalHref(f.value, portal, undefined, propertyF)}
                  className={`focus-ring rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    durum === f.value
                      ? "bg-ink-950 text-white"
                      : "border border-line text-text-muted hover:text-ink-950"
                  }`}
                >
                  {f.label}
                </Link>
              ))}
              {portal ? (
                <Link
                  href={portalHref(durum, "", undefined, propertyF)}
                  className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/20"
                  aria-label={`${portal} portal filtresini kaldır`}
                >
                  {portal} <X className="h-3 w-3" />
                </Link>
              ) : null}
              {propertyF ? (
                <Link
                  href={portalHref(durum, portal)}
                  className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/20"
                  aria-label="Portföy filtresini kaldır"
                >
                  {propertyChip ? propertyChip.property_code : "Portföy"} <X className="h-3 w-3" />
                </Link>
              ) : null}
            </div>
          </div>
          {totalFiltered === 0 ? (
            <div className="grid place-items-center px-6 py-14 text-center">
              <RadioTower className="h-8 w-8 text-text-faint" />
              <p className="mt-3 text-sm font-semibold text-ink-950">Bu filtreyle eşleşen yayın kaydı yok</p>
              <Link href="/app/portallar" className="mt-1 text-sm font-semibold text-brand-600 hover:underline">
                Filtreyi temizle
              </Link>
            </div>
          ) : (
          <BulkConfirmForm selectableCount={liveOnPage}>
          <div className="divide-y divide-line">
            {pageRows.map((row) => {
              const property = propertyOf(row.property);
              const isLive = row.status === "live";
              const isOverdue = isLive && daysSince(row.last_confirmed_at) >= 7;
              return (
                <article key={row.id} className="grid gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[auto_1.3fr_.8fr_.8fr_auto] lg:items-center">
                  {/* Toplu teyit seçimi — yalnızca canlı ilanlar teyitlenebilir */}
                  {isLive ? (
                    <input
                      type="checkbox"
                      name="ids"
                      value={row.id}
                      aria-label={`${property?.property_code ?? row.portal_name} ilanını seç`}
                      className="focus-ring h-4 w-4 shrink-0 accent-[var(--brand-600)]"
                    />
                  ) : (
                    <span aria-hidden className="h-4 w-4 shrink-0" />
                  )}
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] ${isLive ? "bg-brand-600/10 text-brand-600" : "bg-ink-950/5 text-text-faint"}`}><RadioTower className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      {property ? (
                        <Link href={`/app/portfoyler/${property.id}`} className="focus-ring group/prop block">
                          <p className="truncate text-sm font-semibold text-ink-950 transition group-hover/prop:text-brand-600">
                            {property.title ?? "İsimsiz portföy"}
                            <ArrowUpRight className="ml-1 inline h-3 w-3 text-text-faint opacity-0 transition group-hover/prop:text-brand-600 group-hover/prop:opacity-100" />
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">{property.property_code} · {row.portal_name}{row.portal_listing_id ? ` #${row.portal_listing_id}` : ""}</p>
                        </Link>
                      ) : (
                        <>
                          <p className="truncate text-sm font-semibold text-ink-950">Portföy bulunamadı</p>
                          <p className="mt-0.5 text-xs text-text-muted">— · {row.portal_name}{row.portal_listing_id ? ` #${row.portal_listing_id}` : ""}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${isLive ? "bg-mint-500/10 text-mint-600" : "bg-ink-950/5 text-text-muted"}`}>
                      {isLive ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Siren className="h-3.5 w-3.5" />}{isLive ? "Yayında" : "Kapandı"}
                    </span>
                    {!isLive && row.removal_reason ? <p className="mt-1 text-[11px] text-text-faint">{row.removal_reason}</p> : null}
                  </div>
                  <div className={`text-xs ${isOverdue ? "text-amber-500" : "text-text-muted"}`}>
                    <p className="flex items-center gap-1.5">{isOverdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />}{relativeConfirm(row.last_confirmed_at)}</p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {row.portal_url ? <a href={row.portal_url} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-[9px] border border-line text-text-faint transition hover:border-brand-300 hover:text-brand-600" aria-label="İlanı aç"><ExternalLink className="h-4 w-4" /></a> : null}
                    {isLive ? (
                      <>
                        <ConfirmListingButton listingId={row.id} />
                        <ClosePortalDialog listingId={row.id} label={`${property?.property_code ?? ""} · ${row.portal_name}`} />
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          </BulkConfirmForm>
          )}
          {totalPages > 1 ? (
            <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              {page > 1 ? (
                <Link href={portalHref(durum, portal, page - 1, propertyF)} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                  ← Önceki
                </Link>
              ) : (
                <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
              )}
              <span className="text-xs tabular-nums text-text-muted">Sayfa {Math.min(page, totalPages)} / {totalPages}</span>
              {page < totalPages ? (
                <Link href={portalHref(durum, portal, page + 1, propertyF)} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                  Sonraki →
                </Link>
              ) : (
                <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
              )}
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
