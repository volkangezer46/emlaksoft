/* eslint-disable @next/next/no-img-element -- yetkili küçük resim ucundan (`/api/property-media/<id>/thumb`) gelen sabit oranlı kapaklar; next/image istemci kodu eklemez */
import type { ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Cloud,
  FileSignature,
  Gauge,
  Home,
  Layers,
  ListTodo,
  MapPin,
  MoreHorizontal,
  Phone,
  Route,
  Snowflake,
  Sun,
  Moon,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
import { AreaTrendChart } from "@/components/ui/viz/server-charts";
import { monotonePath } from "@/components/ui/viz/curve";
import { HeroScene } from "@/components/ui/art/hero-scene";
import type { Weather } from "@/lib/weather";
import { Kopyala } from "./kopyala";
import { FavoriKalp } from "./favori-kalp";
import { GorevKutusu } from "./gorev-kutusu";
import {
  SALES_RANGES,
  priceText,
  transactionLabel,
  type ApptStatus,
  type Delta,
  type ListingCard,
  type SalesRange,
} from "./core";

/* ================================ Ortak ================================ */

export type Tone = "gold" | "brand" | "violet" | "mint" | "rose" | "cyan";

/** Değişim hapı: ↗ %79 (iyi: yeşil, kötü: kırmızı); ekran okuyucuya cümleyle. */
export function DeltaPill({ delta, context = "önceki döneme göre" }: { delta: Delta; context?: string }) {
  if (!delta) return null;
  const arrow = delta.dir === "up" ? "↗" : delta.dir === "down" ? "↘" : "→";
  const tone = delta.dir === "flat" ? "is-flat" : delta.good ? "is-good" : "is-bad";
  return (
    <span className={`kh-delta ${tone}`}>
      <span aria-hidden="true">
        {arrow} {delta.times ? `${delta.times} kat` : `%${delta.pct}`}
      </span>
      <span className="sr-only">
        {context} {delta.times ? `${delta.times} kat` : `%${delta.pct}`} {delta.dir === "up" ? "artış" : delta.dir === "down" ? "azalış" : "değişim yok"}
      </span>
    </span>
  );
}

function CardHead({ icon: Icon, tone, title, id, right }: { icon: LucideIcon; tone: Tone; title: string; id: string; right?: ReactNode }) {
  return (
    <div className="kh-card-head">
      <span className={`kh-ico t-${tone}`} aria-hidden="true">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <h2 id={id} className="kh-card-title">
        {title}
      </h2>
      {right ? <div className="ml-auto flex min-w-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

function SeeAll({ href, label = "Tümünü gör" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="kh-seeall focus-ring">
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

/** JS'siz "⋯" menüsü (details/summary): kapalıyken içerik yerleşimde yok (display:none). */
export function RowMenu({ label, children, align = "right" }: { label: string; children: ReactNode; align?: "right" | "left" }) {
  return (
    <details className="kh-menu group/menu relative">
      <summary aria-label={label} title={label} className="kh-menu-btn focus-ring touch:h-11 touch:w-11">
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div className={`kh-menu-panel ${align === "left" ? "left-0" : "right-0"}`}>{children}</div>
    </details>
  );
}

export function MenuLink({ href, children, icon: Icon }: { href: string; children: ReactNode; icon?: LucideIcon }) {
  return (
    <Link href={href} className="kh-menu-item focus-ring">
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}

/* ================================ KAHRAMAN ================================ */

export type HeroAction = { href: string; label: string; icon: LucideIcon; primary?: boolean };

/**
 * Kahraman: tarih + kapsam, selamlama (emoji yok), TEK öncelik cümlesi ("Önce bununla başlayın: …"), günün kısa özeti,
 * veri tazeliği ("Son güncelleme · Taze"), "Ne yapmak istiyorsun?" araması ve rol bazlı hızlı işlemler. Döngü/nokta/ok YOK:
 * her şey aynı anda okunur (sahip kararı 2026-10-16, "anlamsız carousel noktaları kalksın"). Telefonda süs görseli ≤ 96 px.
 */
export function KurumsalHero({
  dateText,
  greeting,
  name,
  scene,
  focus,
  summary,
  freshness,
  search,
  actions,
  moreActions,
  scope,
  aside,
  photo,
}: {
  dateText: string;
  greeting: string;
  name: string | null;
  scene: "day" | "dusk" | "night";
  /** Günün önceliği (kendi sınırında akar; yedek aynı satır yüksekliğinde). */
  focus: ReactNode;
  /** Günün kısa özeti (randevu, talep, ilan güncellemesi). */
  summary?: ReactNode;
  freshness?: ReactNode;
  search?: ReactNode;
  actions: HeroAction[];
  moreActions: HeroAction[];
  scope?: ReactNode;
  aside?: ReactNode;
  /** Ofisin yayındaki portföy fotoğrafı (kendi sınırında akar); yoksa çizim görünür. */
  photo?: ReactNode;
}) {
  return (
    <section className={`kh-hero ${aside ? "has-aside" : ""}`} aria-labelledby="kh-hero-title" data-scene={scene}>
      <div className="kh-hero-art" aria-hidden="true">
        <HeroScene scene={scene} />
        {photo}
      </div>
      <div className="kh-hero-body">
        <div className="kh-hero-top">
          <p className="kh-date">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {dateText}
          </p>
          {scope ? <div className="kh-hero-scope">{scope}</div> : null}
        </div>
        <h1 id="kh-hero-title" className="kh-hero-title">
          {greeting}
          {name ? (
            <>
              ,{" "}
              <span className="kh-grad">{name}</span>
            </>
          ) : null}
        </h1>
        <div className="kh-hero-focus">{focus}</div>
        {summary || freshness ? (
          <p className="kh-hero-meta">
            {summary}
            {freshness}
          </p>
        ) : null}
        {search ? <div className="kh-hero-search">{search}</div> : null}
        <nav aria-label="Hızlı işlemler" className="kh-actions">
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className={buttonClass({ variant: a.primary ? "primary" : "outline", size: "lg", className: `kh-act ${a.primary ? "is-primary" : ""}` })}>
              <a.icon className="h-4 w-4" aria-hidden="true" />
              {a.label}
            </Link>
          ))}
          {moreActions.length > 0 ? (
            <RowMenu label="Diğer hızlı işlemler" align="left">
              {moreActions.map((a) => (
                <MenuLink key={a.href} href={a.href} icon={a.icon}>
                  {a.label}
                </MenuLink>
              ))}
            </RowMenu>
          ) : null}
        </nav>
      </div>
      {aside ? <div className="kh-hero-aside">{aside}</div> : null}
    </section>
  );
}

/** Kahraman fotoğrafı (yayındaki portföy kapağı): çizimin üstüne biner, sola doğru zemine erir; tıklanmaz (dekoratif). */
export function HeroPhoto({ src, title }: { src: string; title: string }) {
  return <img src={src} alt="" title={title} width={1280} height={520} decoding="async" fetchPriority="high" className="kh-hero-photo" />;
}

/* ================================ OFİS DURUMU ================================ */

const WEATHER_ICON: Record<Weather["kind"], LucideIcon> = { clear: Sun, partly: CloudSun, cloudy: Cloud, fog: CloudFog, rain: CloudRain, snow: Snowflake, storm: CloudLightning };

export function WeatherChip({ weather, city }: { weather: Weather; city: string }) {
  const Icon = weather.kind === "clear" && !weather.isDay ? Moon : WEATHER_ICON[weather.kind];
  return (
    <p className="kh-weather" title={`${city}: ${weather.label}, ${weather.tempC}°C (Open-Meteo)`}>
      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="truncate">{city}</span>
      <span className={`kh-weather-ico k-${weather.kind}`} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <span className="font-bold tabular-nums">{weather.tempC}°C</span>
      <span className="sr-only">, {weather.label}</span>
    </p>
  );
}

export type StatusItem = { icon: LucideIcon; tone: Tone; value: string; label: string; href: string };

export function OfficeStatusPanel({
  ok,
  headline,
  detail,
  time,
  href,
  items,
  weather,
}: {
  ok: boolean;
  headline: string;
  detail: string;
  time: string;
  href: string;
  items: StatusItem[];
  weather?: ReactNode;
}) {
  return (
    <div className="kh-status">
      <Link href={href} className="kh-status-head focus-ring" aria-label={`${headline}: ${detail}. Ayrıntıyı aç`}>
        <span className={`kh-status-dot ${ok ? "is-ok" : "is-warn"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-[var(--heading)]">{headline}</span>
          <span className="block truncate text-xs text-text-muted">{detail}</span>
        </span>
        <time className="text-sm font-bold tabular-nums text-[var(--heading)]">{time}</time>
        <ChevronRight className="h-4 w-4 text-text-faint" aria-hidden="true" />
      </Link>
      {weather}
      {items.length > 0 ? (
        <ul className="kh-status-grid">
          {items.map((it) => (
            <li key={it.label}>
              <Link href={it.href} className="kh-status-item focus-ring">
                <span className={`kh-ico sm t-${it.tone}`} aria-hidden="true">
                  <it.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-bold tabular-nums text-[var(--heading)]">{it.value}</span>
                  <span className="block truncate text-xs text-text-muted">{it.label}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ================================ KPI ================================ */

/** Yumuşak çizgi + alan (son nokta işaretli) ya da mini sütunlar; çizim girişi CSS (stroke-dashoffset), reduced-motion'da yok. */
export function Spark({ values, tone, kind = "line", label }: { values: readonly number[]; tone: Tone; kind?: "line" | "bars"; label: string }) {
  const W = 120;
  const H = 46;
  const max = Math.max(1, ...values);
  if (values.length === 0) return null;
  if (kind === "bars") {
    const bw = W / values.length;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={`kh-spark t-${tone}`} role="img" aria-label={label}>
        {values.map((v, i) => {
          const h = Math.max(3, (v / max) * (H - 4));
          return <rect key={i} x={i * bw + bw * 0.22} y={H - h} width={bw * 0.56} height={h} rx={2.5} className={`kh-bar ${i === values.length - 1 ? "is-last" : ""}`} style={{ animationDelay: `${i * 40}ms` }} />;
        })}
      </svg>
    );
  }
  const pts = values.map((v, i) => ({ x: values.length === 1 ? W : (i / (values.length - 1)) * (W - 6) + 3, y: H - 5 - (v / max) * (H - 12) }));
  const d = monotonePath(pts);
  const last = pts.at(-1)!;
  const gid = `kh-sg-${tone}-${label.length}-${values.length}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`kh-spark t-${tone}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="kh-sg-a" />
          <stop offset="1" className="kh-sg-b" />
        </linearGradient>
      </defs>
      <path d={`${d} L${last.x.toFixed(2)},${H} L${pts[0]!.x.toFixed(2)},${H} Z`} fill={`url(#${gid})`} className="kh-area" />
      <path d={d} pathLength={1} className="kh-line" />
      <circle cx={last.x} cy={last.y} r={3.4} className="kh-dot" />
    </svg>
  );
}

export function KpiCard({
  title,
  value,
  href,
  icon: Icon,
  tone,
  delta,
  caption,
  spark,
  menu,
}: {
  title: string;
  value: string;
  href: string;
  icon: LucideIcon;
  tone: Tone;
  delta?: Delta;
  caption?: string;
  spark?: ReactNode;
  menu?: ReactNode;
}) {
  return (
    <article className={`kh-card kh-kpi t-${tone}`}>
      <div className="kh-kpi-top">
        <span className={`kh-ico lg t-${tone}`} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="kh-kpi-title" title={title}>
          {title}
        </h3>
        {menu ? (
          <RowMenu label={`${title}: seçenekler`}>{menu}</RowMenu>
        ) : null}
      </div>
      <div className="kh-kpi-body">
        <div className="min-w-0">
          <Link href={href} className="kh-kpi-value focus-ring" aria-label={`${title}: ${value}. Ayrıntıyı aç`}>
            {value}
          </Link>
          <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
            {delta ? <DeltaPill delta={delta} context="geçen aya göre" /> : null}
            {caption ? <span className="text-xs text-text-muted">{caption}</span> : null}
          </div>
        </div>
        {spark ? <div className="kh-kpi-spark">{spark}</div> : null}
      </div>
    </article>
  );
}

export function KpiMenu({ reportHref, targetHref, copyText }: { reportHref: string; targetHref?: string | null; copyText: string }) {
  return (
    <>
      <MenuLink href={reportHref} icon={BarChart3}>
        Raporu aç
      </MenuLink>
      {targetHref ? (
        <MenuLink href={targetHref} icon={Gauge}>
          Hedef belirle
        </MenuLink>
      ) : null}
      <Kopyala text={copyText} />
    </>
  );
}

/* ================================ SATIŞ PERFORMANSI ================================ */

export type SalesFilterOption = { href: string; label: string; active: boolean };

export function SalesPerformance({
  range,
  rangeHref,
  total,
  totalDelta,
  count,
  countDelta,
  avgDays,
  avgDelta,
  series,
  filterLabel,
  filters,
  advisorFilters,
  href,
}: {
  range: SalesRange;
  rangeHref: (r: SalesRange) => string;
  total: string;
  totalDelta: Delta;
  count: number;
  countDelta: Delta;
  avgDays: number | null;
  avgDelta: Delta;
  series: { label: string; value: number; href?: string }[];
  filterLabel: string;
  filters: SalesFilterOption[];
  advisorFilters: SalesFilterOption[];
  href: string;
}) {
  const ctxText = range === "ay" ? "geçen ayın aynı dönemine göre" : range === "6ay" ? "önceki 6 aya göre" : "geçen yılın aynı dönemine göre";
  return (
    <section className="kh-card kh-sales" aria-labelledby="kh-sales-title">
      <CardHead
        icon={BarChart3}
        tone="brand"
        id="kh-sales-title"
        title="Satış performansı"
        right={
          <>
            <nav aria-label="Satış dönemi" className="kh-seg">
              {SALES_RANGES.map((r) => (
                <Link key={r.key} href={rangeHref(r.key)} scroll={false} aria-current={r.key === range ? "true" : undefined} className="kh-seg-item focus-ring">
                  {r.label}
                </Link>
              ))}
            </nav>
            <details className="kh-filter relative">
              <summary className="kh-filter-btn focus-ring touch:min-h-11">
                <span className="truncate">{filterLabel}</span>
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
              </summary>
              <div className="kh-menu-panel right-0 w-60">
                <p className="kh-menu-cap">Portföy türü</p>
                {filters.map((f) => (
                  <Link key={f.href} href={f.href} scroll={false} aria-current={f.active ? "true" : undefined} className="kh-menu-item focus-ring">
                    {f.active ? <Check className="h-4 w-4" aria-hidden="true" /> : <span className="w-4" />}
                    {f.label}
                  </Link>
                ))}
                {advisorFilters.length > 0 ? (
                  <>
                    <p className="kh-menu-cap">Danışman</p>
                    <div className="max-h-56 overflow-y-auto">
                      {advisorFilters.map((f) => (
                        <Link key={f.href} href={f.href} scroll={false} aria-current={f.active ? "true" : undefined} className="kh-menu-item focus-ring">
                          {f.active ? <Check className="h-4 w-4" aria-hidden="true" /> : <span className="w-4" />}
                          <span className="truncate">{f.label}</span>
                        </Link>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </details>
          </>
        }
      />
      <div className="kh-sales-body">
        <dl className="kh-sales-stats">
          <div>
            <dt>Toplam satış</dt>
            <dd>
              <Link href={href} className="kh-stat-value focus-ring">
                {total}
              </Link>
              <DeltaPill delta={totalDelta} context={ctxText} />
            </dd>
          </div>
          <div>
            <dt>Satılan ilan</dt>
            <dd>
              <Link href={href} className="kh-stat-value focus-ring">
                {count}
              </Link>
              <DeltaPill delta={countDelta} context={ctxText} />
            </dd>
          </div>
          <div>
            <dt>Ortalama satış süresi</dt>
            <dd>
              <Link href="/app/raporlar/satis-hizi" className="kh-stat-value focus-ring">
                {avgDays == null || avgDays < 1 ? "—" : `${avgDays} gün`}
              </Link>
              <DeltaPill delta={avgDelta} context={ctxText} />
            </dd>
          </div>
        </dl>
        <div className="kh-sales-chart">
          <AreaTrendChart
            data={series}
            tone="brand"
            format="money"
            name="Satış tutarı"
            summary="none"
            animationKey={`${range}-${filterLabel}`}
            granularity={range === "ay" ? "day" : "month"}
            ariaLabel={range === "ay" ? "Bu ay günlük birikimli satış tutarı" : "Aylık satış tutarı"}
            emptyText="Bu dönemde kapanan satış yok"
          />
        </div>
      </div>
    </section>
  );
}

/* ================================ RANDEVU ZAMAN ÇİZELGESİ ================================ */

export type TimelineRow = {
  id: string;
  time: string;
  type: string;
  typeKey: string | null;
  customer: string;
  place: string | null;
  status: ApptStatus;
  href: string;
  directions: string | null;
};

const TYPE_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  showing: { icon: Home, tone: "mint" },
  office: { icon: Building2, tone: "brand" },
  valuation: { icon: Gauge, tone: "violet" },
  contract: { icon: FileSignature, tone: "gold" },
  call: { icon: Phone, tone: "cyan" },
  phone: { icon: Phone, tone: "cyan" },
};

/**
 * BUGÜNÜN PROGRAMI: saat sırasıyla randevular. Satırda kişi (2 satıra kadar), tür · konum (2 satıra kadar), sağda küçük
 * durum hapı. Başlıkta "Rota": günün durakları haritada (`/app/randevular?gorunum=rota&gun=bugun`); ≥2 koordinatlı durakta
 * Google Haritalar'da tüm rota da menüden açılır.
 */
export function Timeline({
  rows,
  total,
  emptyAction,
  title = "Bugünün programı",
  routeHref,
  mapsRouteHref,
}: {
  rows: TimelineRow[];
  total: number;
  emptyAction?: { href: string; label: string };
  title?: string;
  routeHref?: string | null;
  mapsRouteHref?: string | null;
}) {
  return (
    <section className="kh-card kh-timeline" aria-labelledby="kh-tl-title">
      <CardHead
        icon={CalendarDays}
        tone="brand"
        id="kh-tl-title"
        title={title}
        right={
          <>
            {routeHref && rows.length > 0 ? (
              <Link href={routeHref} className="kh-chip-btn focus-ring" title={mapsRouteHref ? "Günün rotası haritada" : "Günün durakları"}>
                <Route className="h-4 w-4" aria-hidden="true" />
                Rota
              </Link>
            ) : null}
            <SeeAll href="/app/randevular" label={total > rows.length ? `Tümü (${total})` : "Tümünü gör"} />
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState variant="compact" illustration="randevu" tone="amber" title="Bugün planlı randevu yok" description="Müşteri görüşmesi ya da yer gösterme planlayın." action={emptyAction} />
      ) : (
        <ol className="kh-tl-list">
          {rows.map((r) => {
            const t = TYPE_ICON[r.typeKey ?? ""] ?? { icon: CalendarDays, tone: "brand" as Tone };
            return (
              <li key={r.id} className={`kh-tl-row t-${t.tone}`}>
                <time className="kh-tl-time">{r.time}</time>
                <span className="kh-tl-bar" aria-hidden="true" />
                <span className={`kh-ico sm t-${t.tone}`} aria-hidden="true">
                  <t.icon className="h-4 w-4" />
                </span>
                <Link href={r.href} className="kh-tl-main focus-ring" title={[r.customer, r.type, r.place].filter(Boolean).join(" · ")}>
                  <span className="kh-clamp2 text-sm font-semibold text-[var(--heading)]">{r.customer}</span>
                  <span className="kh-clamp2 text-xs text-text-muted">{[r.type, r.place].filter(Boolean).join(" · ")}</span>
                </Link>
                <span className={`kh-pill t-${r.status.tone}`}>{r.status.label}</span>
                <RowMenu label={`${r.time} ${r.customer}: seçenekler`}>
                  <MenuLink href={r.href} icon={CalendarDays}>
                    Randevuyu aç
                  </MenuLink>
                  {r.directions ? (
                    <a href={r.directions} target="_blank" rel="noopener noreferrer" className="kh-menu-item focus-ring">
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      Yol tarifi
                    </a>
                  ) : null}
                  {mapsRouteHref ? (
                    <a href={mapsRouteHref} target="_blank" rel="noopener noreferrer" className="kh-menu-item focus-ring">
                      <Route className="h-4 w-4" aria-hidden="true" />
                      Günün tüm rotası
                    </a>
                  ) : null}
                </RowMenu>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ================================ SON EKLENEN İLANLAR ================================ */

/** Fotoğrafsız ilan çizimi (son halka): sıcak gökyüzü + ev silueti; token renkleri, koyu temada da okunur. */
function ListingArt() {
  return (
    <svg viewBox="0 0 160 96" className="kh-ls-art" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <rect width="160" height="96" className="kh-ls-art-sky" />
      <circle cx="122" cy="26" r="11" className="kh-ls-art-sun" />
      <path d="M0 78 Q40 66 80 74 T160 70 V96 H0Z" className="kh-ls-art-hill" />
      <path d="M52 52 L80 32 L108 52 V80 H52Z" className="kh-ls-art-wall" />
      <path d="M46 54 L80 28 L114 54" className="kh-ls-art-roof" />
      <rect x="73" y="60" width="14" height="20" rx="1.5" className="kh-ls-art-door" />
      <rect x="58" y="56" width="10" height="9" rx="1.5" className="kh-ls-art-win" />
      <rect x="92" y="56" width="10" height="9" rx="1.5" className="kh-ls-art-win" />
    </svg>
  );
}

/**
 * Son eklenen ilanlar. Kapak zinciri: ilanın kendi kapak fotoğrafı → ofisin vitrin kapağı (yayındaki portföy fotoğrafı,
 * "Fotoğraf eklenmedi" etiketiyle, soluk; başka ilanın fotoğrafı bu ilanınmış gibi gösterilmez) → çizim.
 */
export function RecentListings({ cards, scope, newHref, fallbackSrc }: { cards: ListingCard[]; scope: string; newHref?: string | null; fallbackSrc?: string | null }) {
  return (
    <section className="kh-card kh-listings" aria-labelledby="kh-ls-title">
      <CardHead icon={Layers} tone="brand" id="kh-ls-title" title="Son eklenen ilanlar" right={<SeeAll href="/app/portfoyler" />} />
      {cards.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="portfoy"
          title="Henüz portföy yok"
          description="İlk portföyünüzü ekleyin; fotoğraflı kartlar burada görünür."
          action={newHref ? { href: newHref, label: "Yeni ilan" } : undefined}
        />
      ) : (
        <ul className="kh-ls-grid">
          {cards.map((c) => {
            const tr = transactionLabel(c.transaction);
            return (
              <li key={c.id} className="kh-ls-card">
                <div className="kh-ls-media">
                  {c.coverSrc ? (
                    <img src={c.coverSrc} alt="" width={480} height={288} loading="lazy" decoding="async" className="kh-ls-img" />
                  ) : fallbackSrc ? (
                    <>
                      <img src={fallbackSrc} alt="" width={480} height={288} loading="lazy" decoding="async" className="kh-ls-img is-fallback" />
                      <span className="kh-ls-nophoto">Fotoğraf eklenmedi</span>
                    </>
                  ) : (
                    <>
                      <ListingArt />
                      <span className="kh-ls-nophoto">Fotoğraf eklenmedi</span>
                    </>
                  )}
                  {c.badge ? (
                    <span className={`kh-ls-badge t-${c.badge.tone}`} title={c.badge.hint}>
                      {c.badge.label}
                    </span>
                  ) : tr ? (
                    <span className="kh-ls-badge t-neutral">{tr}</span>
                  ) : null}
                  <span className="kh-ls-fav">
                    <FavoriKalp id={c.id} title={c.title} scope={scope} />
                  </span>
                </div>
                <Link href={`/app/portfoyler/${c.id}`} className="kh-ls-body focus-ring">
                  <span className="block truncate text-sm font-semibold text-[var(--heading)]">{c.title}</span>
                  <span className="block truncate text-xs text-text-muted">
                    {[c.district, c.rooms, c.sqm ? `${c.sqm.toLocaleString("tr-TR")} m²` : null].filter(Boolean).join(" · ") || "Konum girilmedi"}
                  </span>
                  <span className="kh-ls-price">{priceText(c.price, c.currency)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ================================ GÖREVLER ================================ */

export type TaskRowView = {
  id: string;
  title: string;
  href: string;
  due: { label: string; tone: "danger" | "brand" | "neutral" };
  high: boolean;
  assignee: { name: string; avatarUrl: string | null; avatarPreset: string | null } | null;
};

export function TaskList({ rows, canComplete, newHref }: { rows: TaskRowView[]; canComplete: boolean; newHref?: string | null }) {
  return (
    <section className="kh-card kh-tasks" aria-labelledby="kh-tk-title">
      <CardHead icon={ListTodo} tone="rose" id="kh-tk-title" title="Yapılacak görevlerim" right={<SeeAll href="/app/gorevler" />} />
      {rows.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="gorev"
          tone="mint"
          title="Bu hafta için açık görev yok"
          description="Yeni görev ekleyerek haftanızı planlayın."
          action={newHref ? { href: newHref, label: "Görev oluştur" } : undefined}
        />
      ) : (
        <ul className="kh-tk-list">
          {rows.map((t) => (
            <li key={t.id} className="kh-task">
              {canComplete ? <GorevKutusu id={t.id} title={t.title} /> : <ClipboardCheck className="h-4 w-4 text-text-faint" aria-hidden="true" />}
              <Link href={t.href} className="kh-task-title focus-ring">
                {t.high ? <span className="kh-prio" title="Yüksek öncelik" aria-label="Yüksek öncelik" /> : null}
                <span className="kh-clamp2" title={t.title}>
                  {t.title}
                </span>
              </Link>
              <span className={`kh-pill t-${t.due.tone === "danger" ? "danger" : t.due.tone === "brand" ? "brand" : "neutral"}`}>{t.due.label}</span>
              {t.assignee ? (
                <span title={t.assignee.name} className="shrink-0">
                  <Avatar name={t.assignee.name} src={t.assignee.avatarUrl} preset={t.assignee.avatarPreset} size="xs" />
                </span>
              ) : null}
              <RowMenu label={`${t.title}: seçenekler`}>
                <MenuLink href={t.href} icon={ClipboardCheck}>
                  Görevi aç
                </MenuLink>
              </RowMenu>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ================================ İSKELETLER ================================ */

export function CardSkeleton({ className = "", rows = 4, title = true }: { className?: string; rows?: number; title?: boolean }) {
  return (
    <div className={`kh-card kh-skel ${className}`} aria-hidden="true">
      {title ? (
        <div className="flex items-center gap-3">
          <span className="skeleton h-9 w-9 rounded-[var(--radius-control)]" />
          <span className="skeleton h-4 w-40 rounded-md" />
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <span key={i} className="skeleton block h-9 rounded-[var(--radius-control)]" style={{ width: `${100 - (i % 3) * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="kh-card kh-kpi kh-skel" aria-hidden="true">
      <div className="flex items-center gap-3">
        <span className="skeleton h-11 w-11 rounded-[var(--radius-control)]" />
        <span className="skeleton h-4 w-28 rounded-md" />
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <span className="skeleton block h-7 w-32 rounded-md" />
          <span className="skeleton block h-4 w-20 rounded-md" />
        </div>
        <span className="skeleton h-11 w-28 rounded-md" />
      </div>
    </div>
  );
}

export const KPI_ICONS = { revenue: Wallet, properties: Home, customers: Users, appointments: CalendarPlus } as const;
