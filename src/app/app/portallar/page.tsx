import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Siren,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { confirmPortalListing } from "@/app/actions/portal-listings";
import { ClosePortalDialog, NewPortalDialog } from "./portal-dialogs";
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

function propertyOf(value: PortalRow["property"]) {
  return Array.isArray(value) ? value[0] : value;
}

function daysSince(value: string | null) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

function relativeConfirm(value: string | null) {
  const days = daysSince(value);
  if (days === 0) return "Bugün teyit edildi";
  if (days === 1) return "Dün teyit edildi";
  return `${days} gün önce teyit`;
}

export default async function PortalsPage() {
  await requireModulePage("portals");
  const supabase = await createClient();
  const [{ data: listings }, { data: properties }] = await Promise.all([
    supabase
      .from("portal_listings")
      .select("id, portal_name, portal_listing_id, portal_url, status, last_confirmed_at, published_at, removed_at, removal_reason, property:properties(id,property_code,title,list_price)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("properties")
      .select("id, property_code, title")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  const rows = (listings ?? []) as PortalRow[];
  const propertyOptions = properties ?? [];
  const live = rows.filter((row) => row.status === "live");
  const overdue = live.filter((row) => daysSince(row.last_confirmed_at) >= 7);
  const removed = rows.filter((row) => row.status === "removed");

  const onTime = live.filter((row) => daysSince(row.last_confirmed_at) < 7).length;
  const healthRate = live.length ? onTime / live.length : 0;
  const portalCounts = new Map<string, number>();
  rows.forEach((row) => portalCounts.set(row.portal_name, (portalCounts.get(row.portal_name) ?? 0) + 1));
  const portalStats = [...portalCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const maxCount = Math.max(1, ...portalStats.map((p) => p.count));

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
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
          <NewPortalDialog properties={propertyOptions} />
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-3">
          {[
            { label: "Canlı ilan", value: live.length, icon: RadioTower, tone: "text-mint-400" },
            { label: "Teyit bekleyen", value: overdue.length, icon: Clock3, tone: "text-amber-400" },
            { label: "Kapanan", value: removed.length, icon: Siren, tone: "text-danger-500" },
          ].map((item) => (
            <div key={item.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
              <item.icon className={`h-4 w-4 ${item.tone}`} />
              <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
              <p className="text-[10px] text-white/45 sm:text-xs">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      {rows.length > 0 ? (
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
              <p className="mt-0.5 text-xs text-text-muted">{onTime}/{live.length} ilan zamanında teyitli</p>
              <p className="mt-1 text-[11px] text-text-faint">{overdue.length} ilan 7+ gündür teyit bekliyor</p>
            </div>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-950"><RadioTower className="h-3.5 w-3.5 text-brand-600" /> Portal dağılımı</p>
            <div className="mt-3 flex h-24 items-end gap-4">
              {portalStats.map((p, i) => (
                <div key={p.name} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] font-bold tabular-nums text-ink-950">{p.count}</span>
                  <div className="flex h-full w-full items-end justify-center">
                    <div
                      className="bar-live w-7 rounded-t-[5px] bg-[image:var(--grad-brand)] shadow-[0_0_12px_-2px_rgba(20,99,255,0.5)]"
                      style={{ height: `${(p.count / maxCount) * 100}%`, animationDelay: `${i * 0.1}s` }}
                    />
                  </div>
                  <span className="max-w-[72px] truncate text-[10px] text-text-muted">{p.name}</span>
                </div>
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

      {rows.length === 0 ? (
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
            <div><h2 className="font-display font-bold text-ink-950">Bağlı portal ilanları</h2><p className="text-xs text-text-muted">{rows.length} yayın kaydı</p></div>
            <div className="flex gap-2">
              <span className="rounded-full bg-mint-500/10 px-2.5 py-1 text-[10px] font-bold text-mint-600">{live.length} canlı</span>
              <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold text-amber-500">{overdue.length} teyit</span>
            </div>
          </div>
          <div className="divide-y divide-line">
            {rows.map((row) => {
              const property = propertyOf(row.property);
              const isLive = row.status === "live";
              const isOverdue = isLive && daysSince(row.last_confirmed_at) >= 7;
              return (
                <article key={row.id} className="grid gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.3fr_.8fr_.8fr_auto] lg:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[12px] ${isLive ? "bg-brand-600/10 text-brand-600" : "bg-ink-950/5 text-text-faint"}`}><RadioTower className="h-5 w-5" /></span>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-950">{property?.title ?? "Portföy bulunamadı"}</p><p className="mt-0.5 text-xs text-text-muted">{property?.property_code ?? "—"} · {row.portal_name}{row.portal_listing_id ? ` #${row.portal_listing_id}` : ""}</p></div>
                  </div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${isLive ? "bg-mint-500/10 text-mint-600" : "bg-ink-950/5 text-text-muted"}`}>
                      {isLive ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Siren className="h-3.5 w-3.5" />}{isLive ? "Yayında" : "Kapandı"}
                    </span>
                    {!isLive && row.removal_reason ? <p className="mt-1 text-[10px] text-text-faint">{row.removal_reason}</p> : null}
                  </div>
                  <div className={`text-xs ${isOverdue ? "text-amber-500" : "text-text-muted"}`}>
                    <p className="flex items-center gap-1.5">{isOverdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />}{relativeConfirm(row.last_confirmed_at)}</p>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {row.portal_url ? <a href={row.portal_url} target="_blank" rel="noreferrer" className="grid h-9 w-9 place-items-center rounded-[9px] border border-line text-text-faint transition hover:border-brand-300 hover:text-brand-600" aria-label="İlanı aç"><ExternalLink className="h-4 w-4" /></a> : null}
                    {isLive ? (
                      <>
                        <form action={confirmPortalListing}>
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" className="inline-flex items-center gap-1.5 rounded-[9px] border border-mint-500/20 px-3 py-2 text-xs font-semibold text-mint-600 transition hover:bg-mint-500/8"><RefreshCw className="h-3.5 w-3.5" /> Teyit</button>
                        </form>
                        <ClosePortalDialog listingId={row.id} label={`${property?.property_code ?? ""} · ${row.portal_name}`} />
                      </>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
