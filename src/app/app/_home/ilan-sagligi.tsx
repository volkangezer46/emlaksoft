import Link from "@/components/ui/smart-link";
import { Suspense, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight, FileClock, Gauge, HeartPulse, Radar, ShieldAlert } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { createClient } from "@/lib/supabase/server";
import { getControlSummary } from "@/lib/listing-control/server/readers";
import type { Db } from "@/lib/listing-control/server/db";
import { healthyPercent, kpiHref, sumSummaryRows, type GroupParam } from "@/components/listing-control/helpers";
import { KpiCard } from "@/components/ui/kpi-card";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EXPIRING_CAP, loadClosures, loadExpiringAuthority, loadLiveListings, type HomeCtx } from "./data";
import { overdueListingsOf, portalHealth } from "./helpers";

/**
 * İLAN SAĞLIĞI — ana ekranda ilan olgularının TEK bloğu. Eskiden aynı olgu dört yerde yaşıyordu (Portföy sağlığı kartı,
 * Kaçan komisyonlar, Portal sağlığı, Dikkat'teki teyitsiz ilan + yetkisi dolan); artık yalnız burada:
 *  - sağlık oranı + kritik/inceleme/sağlıklı (İlan Kontrol özet RPC'si; rol kapsamı RLS'te),
 *  - teyitsiz ilan, portal teyit oranı + portal kırılımı,
 *  - kayıp/kapanmış ilan (portalda kayıp + tahmini kaçan komisyon),
 *  - yetkisi dolan portföy.
 * Kapsam ana ekranla aynı: "Ben" → yönetimde kendi danışman satırı/portföyleri; danışmanda zaten yalnız kendi ilanları
 * (RLS + `ctx.scopeMine`). Her sayı filtreli hedefe gider (sıfır çıkmaz metrik); veri yoksa satır/blok çizilmez.
 * Rol yerleşimi `home-layout.ts` (`listingHealth`) tarafından belirlenir; kapalı modüller sayfadan `closed` ile gelir.
 */
export type IlanSagligiClosed = { portals: boolean; leak: boolean };

export function IlanSagligi({ ctx, closed }: { ctx: HomeCtx; closed: IlanSagligiClosed }) {
  if (!ctx.tenantId) return null;
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <IlanSagligiGovde ctx={ctx} closed={closed} />
    </Suspense>
  );
}

function Satir({ href, tone, icon, title, sub }: { href: string; tone: "danger" | "warn" | "brand"; icon: ReactNode; title: string; sub: string }) {
  return (
    <li>
      <Link href={href} className="ds-row focus-ring group touch:min-h-11">
        <span className={`ds-row-ico pm-t-${tone}`} aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text">{title}</span>
          <span className="block truncate text-xs text-text-muted">{sub}</span>
        </span>
        <ChevronRight className="ds-row-chev h-4 w-4" aria-hidden="true" />
      </Link>
    </li>
  );
}

async function IlanSagligiGovde({ ctx, closed }: { ctx: HomeCtx; closed: IlanSagligiClosed }) {
  const canPortals = !closed.portals && (ctx.perms.portals ?? []).includes("view");
  const ownRow = ctx.isManagement && ctx.scopeMine;
  const officeClosures = !closed.leak && ctx.isManagement && !ctx.scopeMine;

  const [control, listings, expiring, closures] = await Promise.all([
    canPortals
      ? createClient().then((c) => getControlSummary(c as unknown as Db, ownRow ? "advisor" : "tenant")).catch(() => null)
      : Promise.resolve(null),
    canPortals ? loadLiveListings(ctx).catch(() => null) : Promise.resolve(null),
    ctx.canSeeProperties ? loadExpiringAuthority(ctx).catch(() => null) : Promise.resolve(null),
    officeClosures ? loadClosures(ctx).catch(() => null) : Promise.resolve(null),
  ]);

  const rows = control?.available ? (ownRow ? control.rows.filter((r) => r.group_id === ctx.userId) : control.rows) : [];
  const s = sumSummaryRows(rows);
  const pct = healthyPercent(s);
  const hasSummary = s.total_active > 0 && pct !== null;

  const group: GroupParam = ownRow ? "danisman" : "ofis";
  const groupId = ownRow ? ctx.userId : null;
  const href = (k: "portal_missing" | "in_review" | "healthy") => kpiHref(k, group, groupId);

  const unconfirmed = listings ? overdueListingsOf(listings).length : 0;
  const { pct: portalPct, portals } = portalHealth(listings ?? []);
  const expiringCount = expiring?.data.length ?? 0;
  const mineOwner = ctx.scopeMine ? `&danisman=${encodeURIComponent(ctx.userId)}` : "";
  const lost = (closures?.recent ?? []).filter((c) => Number(c.estimated_lost_commission || 0) > 0).slice(0, 3);
  const lostTotal = lost.reduce((sum, c) => sum + Number(c.estimated_lost_commission || 0), 0);
  const portalMissing = hasSummary ? s.portal_missing : 0;

  const hasRows = unconfirmed > 0 || expiringCount > 0 || portalMissing > 0 || lost.length > 0 || (listings?.length ?? 0) > 0;
  if (!hasSummary && !hasRows) return null;

  const tone = pct === null ? "warn" : pct >= 85 ? "success" : pct >= 60 ? "warn" : "danger";
  const items = hasSummary
    ? [
        { key: "kritik", label: "kritik", hint: "Portal ilanı kayıp", value: s.portal_missing, href: href("portal_missing"), dot: "bg-danger-600" },
        { key: "inceleme", label: "inceleme", hint: "Açıklama bekleyen uyarı", value: s.in_review, href: href("in_review"), dot: "bg-warning-strong" },
        { key: "saglikli", label: "sağlıklı", hint: "Sorunsuz ve güncel", value: s.healthy, href: href("healthy"), dot: "bg-mint-600" },
      ]
    : [];

  return (
    <section aria-labelledby="ilan-sagligi-baslik" className="ds-card ds-pad" data-tour="ilan-sagligi">
      <header className="ds-head mb-3">
        <span className="pm-ico pm-t-brand" aria-hidden="true">
          <HeartPulse />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ilan-sagligi-baslik" className="ds-title">
            İlan sağlığı
          </h2>
          <p className="ds-sub mt-0.5">
            {ownRow || !ctx.isManagement ? "Kendi portföyleriniz" : "Ofis geneli"}
            {hasSummary ? ` · ${s.total_active} aktif portföy` : ""}
          </p>
        </div>
        <Link href="/app/ilan-kontrol" className="ds-link focus-ring">
          İlan Kontrol <ArrowUpRight aria-hidden="true" />
        </Link>
      </header>

      {hasSummary ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-center">
          <KpiCard label="Sağlıklı oranı" value={`%${pct}`} href={href("healthy")} icon={HeartPulse} tone={tone} layout="inline" hint={`${s.healthy} / ${s.total_active} portföy`} />
          <ul className="flex flex-wrap items-center gap-2">
            {items.map((it) => (
              <li key={it.key}>
                <Link href={it.href} title={it.hint} className="focus-ring inline-flex min-h-10 touch:min-h-11 items-center gap-2 rounded-full border border-hairline bg-surface-raised px-3 text-sm transition hover:border-brand-400">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${it.dot}`} />
                  <span className="font-semibold tabular-nums text-text">{it.value}</span>
                  <span className="text-text-muted">{it.label}</span>
                </Link>
              </li>
            ))}
            <li>
              <ButtonLink
                href={ownRow ? `/app/ilan-kontrol/anomaliler?danisman=${encodeURIComponent(ctx.userId)}` : "/app/ilan-kontrol/anomaliler"}
                iconRight={ChevronRight}
                size="sm"
              >
                Sorunları incele
              </ButtonLink>
            </li>
          </ul>
        </div>
      ) : null}

      {hasRows ? (
        <ul className={`ds-sep -mx-1.5 ${hasSummary ? "mt-3" : ""}`}>
          {unconfirmed > 0 ? (
            <Satir
              href="/app/portallar?durum=teyit"
              tone="warn"
              icon={<FileClock />}
              title={`${unconfirmed} ilan 7+ gündür teyitsiz`}
              sub="Portalda son 7 günde teyit edilmedi"
            />
          ) : null}
          {portalMissing > 0 ? (
            <Satir
              href={href("portal_missing")}
              tone="danger"
              icon={<Radar />}
              title={`${portalMissing} portföyde portal ilanı kayıp`}
              sub="İlan Kontrol Merkezi: doğrulanan kayıplar"
            />
          ) : null}
          {lost.length > 0 ? (
            <Satir
              href="/app/kayip-kacak"
              tone="danger"
              icon={<Radar />}
              title={`Son kapanışlarda tahmini kaçan komisyon: ${moneyTry(lostTotal)}`}
              sub={`${lost.length} kapanmış ilan · ${lost[0]?.reason ?? "neden belirtilmemiş"}`}
            />
          ) : null}
          {expiringCount > 0 ? (
            <Satir
              href={`/app/portfoyler?yetki=bitiyor${mineOwner}`}
              tone="warn"
              icon={<ShieldAlert />}
              title={
                expiringCount >= EXPIRING_CAP
                  ? "Yetkisi 15 gün içinde dolan portföyler var"
                  : `${expiringCount} portföyün yetkisi 15 gün içinde doluyor`
              }
              sub={expiring?.data[0] ? (expiring.data[0].title ?? expiring.data[0].property_code ?? "Portföy") : "Yetki belgesi yenilenmeli"}
            />
          ) : null}
          {(listings?.length ?? 0) > 0 ? (
            <Satir
              href="/app/portallar"
              tone={portalPct >= 90 ? "brand" : portalPct >= 70 ? "warn" : "danger"}
              icon={<Gauge />}
              title={`Portal teyit oranı %${portalPct}`}
              sub={`${listings?.length ?? 0} canlı ilan · son 7 günde teyit`}
            />
          ) : null}
        </ul>
      ) : null}
      {portals.length > 0 && (listings?.length ?? 0) > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Portal kırılımı">
          {portals.map((p) => (
            <li key={p.name}>
              <Link
                href={`/app/portallar?portal=${encodeURIComponent(p.name)}`}
                title="Portala göre teyit durumu"
                className="focus-ring inline-flex min-h-10 touch:min-h-11 items-center gap-2 rounded-full border border-hairline bg-surface-raised px-3 text-sm transition hover:border-brand-400"
              >
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${p.tone}`} />
                <span className="font-semibold text-text">{p.name}</span>
                <span className="tabular-nums text-text-muted">
                  {p.healthy}/{p.live} teyitli
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
