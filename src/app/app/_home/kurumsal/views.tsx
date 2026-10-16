/* eslint-disable @next/next/no-img-element -- yetkili küçük resim ucundan (`/api/property-media/<id>/thumb`) gelen sabit oranlı kapaklar; next/image istemci kodu eklemez */
import { Fragment, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Coins,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSignature,
  FileText,
  Gauge,
  Goal,
  Handshake,
  Home,
  Layers,
  ListTodo,
  MapPin,
  MoreHorizontal,
  Phone,
  PhoneIncoming,
  Plus,
  Route,
  Target,
  UserRound,
  UserX,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { KurulumIcon, OfisteIcon } from "@/components/ui/icons/brand-icons";
import { PortalMenu } from "@/components/ui/portal-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { AreaTrendChart } from "@/components/ui/viz/server-charts";
import { monotonePath } from "@/components/ui/viz/curve";
import { HeroScene } from "@/components/ui/art/hero-scene";
import { Kopyala } from "./kopyala";
import { FavoriKalp } from "./favori-kalp";
import { GorevKutusu } from "./gorev-kutusu";
import {
  SALES_RANGES,
  priceText,
  transactionLabel,
  type ApptStatus,
  type Delta,
  type SentencePart,
  type ListingCard,
  type SalesRange,
} from "./core";

/* ================================ Ortak ================================ */

export type Tone = "gold" | "brand" | "violet" | "mint" | "rose" | "cyan" | "pink" | "orange" | "amber" | "slate" | "sky";

/** Değişim hapı: ↗ %79 · ↗ 3,2 kat · ↗ yeni (kural `@/lib/trend`; iyi: yeşil, kötü: kırmızı); ekran okuyucuya cümleyle. */
export function DeltaPill({ delta, context = "önceki döneme göre" }: { delta: Delta; context?: string }) {
  if (!delta) return null;
  const arrow = delta.dir === "up" ? "↑" : delta.dir === "down" ? "↓" : "→";
  const tone = delta.dir === "flat" ? "is-flat" : delta.good ? "is-good" : "is-bad";
  return (
    <span className={`kh-delta ${tone}`}>
      <span aria-hidden="true">
        {arrow} {delta.text}
      </span>
      <span className="sr-only">
        {context} {delta.spoken}
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

function SeeAll({ href, label = "Tümünü gör", pill = false }: { href: string; label?: string; pill?: boolean }) {
  return (
    <Link href={href} className={`kh-seeall focus-ring ${pill ? "is-pill" : ""}`}>
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * "⋯" menüsü: panel portal katmanında çizilir (`PortalMenu`, Radix Popover Portal) — kartın `overflow:hidden`'ı ya da
 * komşu kartın yığılma bağlamı menüyü kırpamaz / arkada bırakamaz.
 */
export function RowMenu({ label, children, align = "right", className = "" }: { label: string; children: ReactNode; align?: "right" | "left"; className?: string }) {
  return (
    <PortalMenu
      label={label}
      align={align === "left" ? "start" : "end"}
      triggerClassName={`kh-menu-btn focus-ring touch:h-11 touch:w-11 ${className}`}
      trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
    >
      {children}
    </PortalMenu>
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

/**
 * Sayarak beliren sayı (YALNIZ CSS, istemci JS'i yok): düz tam sayılar (1–4 hane, ayırıcısız) `@property` sayacıyla 0'dan
 * değerine sayar; gerçek metin yerinde kalır (genişlik sabit → CLS 0, ekran okuyucu gerçek değeri okur). Tutar / yüzde /
 * "—" olduğu gibi yazılır. Hareket yalnız `prefers-reduced-motion: no-preference` ve ilk tam yüklemede (home.css).
 */
export function CountUp({ text }: { text: string }) {
  if (!/^\d{1,4}$/.test(text)) return <>{text}</>;
  return (
    <span className="kh-count" style={{ ["--kh-to" as string]: Number(text) }}>
      <span className="kh-count-txt">{text}</span>
    </span>
  );
}

/* ================================ KAHRAMAN ================================ */

export type HeroAction = { href: string; label: string; icon: LucideIcon; primary?: boolean };

/** Kahraman zemini: seçilmiş fotoğraf (`getHeroPhoto`) ya da ofisin yayındaki portföy kapağı; boyutlu, CLS yok. */
export type HeroPhotoSource = { src: string; srcSet?: string; width: number; height: number; title: string; focus?: string };

/**
 * KAHRAMAN (v4 referansı): fotoğraf zemini (sağda; solda yazı için yumuşak örtü), tarih hapı + kapsam anahtarı,
 * "İyi geceler, <Ad Soyad>" (ad altın), kalın sayılı özet cümlesi, durum hapları (tazelik · geciken · onay; her biri
 * süzülmüş listeye gider), "Ne yapmak istiyorsun?" komut çubuğu ve rol bazlı hızlı işlemler ("…" portal menüsü). Sağda
 * koyu cam "Ofis durumu" paneli (yönetim) / "Günüm" (danışman) / "Finans durumu" (muhasebe). Telefonda fotoğraf ≤ 140 px,
 * panel yatay kaydırmalı karolar. Döngü/nokta/ok YOK; fotoğrafın hafif paralaksı yalnız CSS kaydırma zaman çizelgesiyle.
 */
export function KurumsalHero({
  dateText,
  greeting,
  name,
  scene,
  summary,
  status,
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
  /** Günün kısa özeti (kalın sayılar; kendi sınırında akar, yedek aynı satır yüksekliğinde). */
  summary?: ReactNode;
  /** Durum hapları satırı (tazelik + geciken + onay). */
  status?: ReactNode;
  search?: ReactNode;
  actions: HeroAction[];
  moreActions: HeroAction[];
  scope?: ReactNode;
  aside?: ReactNode;
  /** Zemin fotoğrafı (kendi sınırında akar); yoksa çizim görünür. */
  photo?: ReactNode;
}) {
  return (
    <section className={`kh-hero ${aside ? "has-aside" : ""}`} aria-labelledby="kh-hero-title" data-scene={scene}>
      <div className="kh-hero-art" aria-hidden="true">
        <div className="kh-hero-media">
          <HeroScene scene={scene} />
          {photo}
        </div>
        <span className="kh-hero-veil" />
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
              <span className="kh-name">{name}</span>
            </>
          ) : null}
        </h1>
        {summary ? <p className="kh-hero-lead">{summary}</p> : null}
        {status ? <div className="kh-hero-status">{status}</div> : null}
        {search ? <div className="kh-hero-search">{search}</div> : null}
        <nav aria-label="Hızlı işlemler" className="kh-actions">
          {actions.map((a) => (
            <Link key={a.href} href={a.href} className={`kh-act focus-ring press ${a.primary ? "is-primary" : ""}`}>
              {a.primary ? <Plus className="h-4 w-4" aria-hidden="true" /> : <a.icon className="h-4 w-4" aria-hidden="true" />}
              {a.label}
            </Link>
          ))}
          {moreActions.length > 0 ? (
            <PortalMenu
              label="Diğer hızlı işlemler"
              align="start"
              triggerClassName="kh-act kh-hero-more focus-ring press"
              trigger={<MoreHorizontal className="h-5 w-5" aria-hidden="true" />}
            >
              {moreActions.map((a) => (
                <MenuLink key={a.href} href={a.href} icon={a.icon}>
                  {a.label}
                </MenuLink>
              ))}
            </PortalMenu>
          ) : null}
        </nav>
      </div>
      {aside ? <div className="kh-hero-aside">{aside}</div> : null}
    </section>
  );
}

/** Kahraman fotoğrafı: çizimin üstüne biner, iner inmez yumuşakça belirir; dekoratif (alt boş, ad `title`'da). */
export function HeroPhoto({ photo }: { photo: HeroPhotoSource }) {
  return (
    <img
      src={photo.src}
      srcSet={photo.srcSet}
      sizes={photo.srcSet ? "(min-width: 1024px) 70vw, 100vw" : undefined}
      alt=""
      title={photo.title}
      width={photo.width}
      height={photo.height}
      decoding="async"
      fetchPriority="high"
      className="kh-hero-photo"
      style={photo.focus ? { objectPosition: photo.focus } : undefined}
    />
  );
}

/** Kahraman özet cümlesi: sayılar kalın (`heroSentenceParts`). */
export function SentenceText({ parts }: { parts: readonly SentencePart[] }) {
  return (
    <>
      {parts.map((p, i) => (p.strong ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

export type StatusChip = { key: string; label: string; href: string; tone: "danger" | "rose" | "success" | "warn" | "brand" };

/** Durum hapları (kahraman): ilk hap tazelik damgasıdır (`fresh`), diğerleri süzülmüş listeye giden bağlantı. */
export function StatusChips({ fresh, chips }: { fresh?: ReactNode; chips: readonly StatusChip[] }) {
  return (
    <ul className="kh-chips" aria-label="Günün durumu">
      {fresh ? <li className="kh-chip is-fresh">{fresh}</li> : null}
      {chips.map((c) => (
        <li key={c.key}>
          <Link href={c.href} className={`kh-chip is-link t-${c.tone} focus-ring`}>
            <span className="kh-chip-dot" aria-hidden="true" />
            {c.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ================================ OFİS DURUMU (koyu cam panel) ================================ */

export type StatusTileChip = { text: string; tone: "neutral" | "success" | "danger" | "warn"; title?: string; dot?: boolean };
export type StatusTile = { key: string; icon: LucideIcon; tone: Tone; label: string; value: string; unit?: string; chip?: StatusTileChip | null; href: string; title?: string };

export function OfficeStatusPanel({
  title,
  health,
  tiles,
}: {
  title: string;
  /** Sağ üst durum: "Sistem sağlıklı" (yeşil, nabızlı) ya da "n ilan bekliyor" (amber). */
  health: { ok: boolean; label: string; href: string };
  tiles: StatusTile[];
}) {
  return (
    <section className="kh-status" aria-label={title}>
      <header className="kh-status-head">
        <span className="kh-status-mark" aria-hidden="true" />
        <h2 className="kh-status-title">{title}</h2>
        <Link href={health.href} className={`kh-status-health focus-ring ${health.ok ? "is-ok" : "is-warn"}`}>
          <span className="kh-live-dot" aria-hidden="true" />
          {health.label}
        </Link>
      </header>
      {tiles.length > 0 ? (
        <ul className="kh-status-grid">
          {tiles.map((t) => (
            <li key={t.key}>
              <Link href={t.href} title={t.title} className="kh-tile focus-ring" aria-label={`${t.label}: ${t.value}${t.unit ?? ""}${t.chip ? `, ${t.chip.title ?? t.chip.text}` : ""}`}>
                <span className={`kh-tile-ico t-${t.tone}`} aria-hidden="true">
                  <t.icon className="h-5 w-5" />
                </span>
                <span className="kh-tile-label" title={t.label}>{t.label}</span>
                <span className="kh-tile-foot">
                  <span className="kh-tile-value">
                    <CountUp text={t.value} />
                    {t.unit ? <span className="kh-tile-unit">{t.unit}</span> : null}
                  </span>
                  {t.chip ? (
                    <span className={`kh-tile-chip is-${t.chip.tone} ${t.chip.dot ? "has-live" : ""}`} title={t.chip.title ?? t.chip.text}>
                      {t.chip.text}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ================================ KPI ================================ */

/**
 * Mini çubuk grafik (KPI): son kova vurgulu, diğerleri aynı tonun açığı; çubuklar alttan büyür (CSS, reduced-motion'da
 * yok). Çizgi türü (`line`) eski özet bloklarında kalır.
 */
export function Spark({ values, tone, kind = "bars", label }: { values: readonly number[]; tone: Tone; kind?: "line" | "bars"; label: string }) {
  const W = 120;
  const H = 46;
  const max = Math.max(1, ...values);
  if (values.length === 0) return null;
  if (kind === "bars") {
    const bw = W / values.length;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`kh-spark t-${tone}`} role="img" aria-label={label}>
        {values.map((v, i) => {
          const h = Math.max(3, (v / max) * (H - 2));
          // Soldan sağa koyulaşan ton (eski hafta açık, son hafta tam renk): referanstaki dolgun çubuk dili.
          const o = values.length > 1 ? 0.22 + (0.5 * i) / (values.length - 1) : 1;
          return <rect key={i} x={i * bw + bw * 0.18} y={H - h} width={bw * 0.64} height={h} rx={Math.min(2.5, bw * 0.3)} className={`kh-bar ${i === values.length - 1 ? "is-last" : ""}`} style={{ animationDelay: `${120 + i * 35}ms`, ["--kh-bo" as string]: o.toFixed(2) }} />;
        })}
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="kh-base" />
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

/**
 * KPI kartı (v4): renkli ikon karosu · başlık · büyük sayı · değişim (↑ %12, iyi yeşil / kötü kırmızı) · 12 çubuklu mini
 * grafik. Tüm kartlar aynı yükseklikte (`--kpi-h`); sayı filtrelenmiş listeye gider; "⋯" portal menüsü.
 */
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
  deltaContext = "geçen ayın aynı dönemine göre",
}: {
  title: string;
  value: string;
  href: string;
  icon: LucideIcon;
  tone: Tone;
  delta?: Delta;
  /** Ekran okuyucu için karşılaştırma tabanı. */
  deltaContext?: string;
  caption?: string;
  spark?: ReactNode;
  menu?: ReactNode;
}) {
  return (
    <article className={`kh-card kh-kpi t-${tone}`}>
      <span className={`kh-ico lg t-${tone}`} aria-hidden="true">
        <Icon className="h-[22px] w-[22px]" />
      </span>
      <div className="kh-kpi-main">
        <h3 className="kh-kpi-title" title={title}>
          {title}
        </h3>
        <div className="kh-kpi-line">
          <Link href={href} className="kh-kpi-value focus-ring" aria-label={`${title}: ${value}. Ayrıntıyı aç`} title={value}>
            <CountUp text={value} />
          </Link>
        </div>
        <div className="kh-kpi-meta">
          {delta ? <DeltaPill delta={delta} context={deltaContext} /> : null}
          {caption ? <span className="kh-kpi-cap" title={caption}>{caption}</span> : null}
        </div>
      </div>
      {spark ? <div className="kh-kpi-spark">{spark}</div> : null}
      {menu ? <div className="kh-kpi-menu">{<RowMenu label={`${title}: seçenekler`}>{menu}</RowMenu>}</div> : null}
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
  avgNote,
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
  /** `avgDays` null iken "—" yanındaki açıklama (core `salesSummary.avgNote`). */
  avgNote?: string | null;
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
            <PortalMenu
              label={`Satış süzgeci: ${filterLabel}`}
              triggerClassName="kh-filter-btn focus-ring touch:min-h-11"
              contentClassName="w-60"
              trigger={
                <>
                  <span className="truncate">{filterLabel}</span>
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                </>
              }
            >
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
            </PortalMenu>
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
              {avgDays == null && avgNote ? <span className="block text-xs text-text-muted">{avgNote}</span> : <DeltaPill delta={avgDelta} context={ctxText} />}
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
            granularity={range === "ay" ? "week" : "month"}
            ariaLabel={range === "ay" ? "Bu ay haftalık satış tutarı" : "Aylık satış tutarı"}
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
  showing: { icon: Home, tone: "brand" },
  office: { icon: Building2, tone: "brand" },
  valuation: { icon: Gauge, tone: "brand" },
  contract: { icon: FileSignature, tone: "brand" },
  call: { icon: Phone, tone: "brand" },
  phone: { icon: Phone, tone: "brand" },
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
      <CardHead icon={ListTodo} tone="brand" id="kh-tk-title" title="Yapılacak görevlerim" right={<SeeAll href="/app/gorevler" />} />
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

/* ================================ DİKKAT GEREKTİRENLER ================================ */

export type AttentionRow = {
  id: string;
  label: string;
  /** Somut kayıt ("Cevahir Residence D-12 · Ahmet Yılmaz") ya da kategori açıklaması. */
  hint: string;
  href: string;
  level: "acil" | "yuksek" | "orta" | "dusuk";
  /** "12 gün geçti" · "Bugün 14:30"; yaşı olmayan kalemde null. */
  age: string | null;
  /** Yaş geçmişe dönükse (gecikme) önem renginde; randevu saati nötr koyu. */
  overdueAge: boolean;
  /** Kategorinin geri kalanı: "+11 daha". */
  more: string | null;
};

const LEVEL_PILL: Record<AttentionRow["level"], { label: string; tone: string }> = {
  acil: { label: "Acil", tone: "danger" },
  yuksek: { label: "Yüksek", tone: "orange" },
  orta: { label: "Orta", tone: "amber" },
  dusuk: { label: "Düşük", tone: "brand" },
};

/** Kalem türünün ikonu ve karo rengi (referans: kırmızı ev, pembe belge, turuncu telefon, amber takvim, yeşil onay). */
const ATTN_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  tahsilat: { icon: Home, tone: "rose" },
  gorev: { icon: ListTodo, tone: "rose" },
  teyit: { icon: FileText, tone: "pink" },
  "geri-donus": { icon: Phone, tone: "orange" },
  randevu: { icon: CalendarDays, tone: "amber" },
  onay: { icon: CheckCircle2, tone: "mint" },
  "riskli-anlasma": { icon: Handshake, tone: "orange" },
  komisyon: { icon: Wallet, tone: "amber" },
  pasif: { icon: UserX, tone: "slate" },
};

/**
 * DİKKAT GEREKTİRENLER (ana ekran, v5): önem + yaş sıralı TEK KAYIT satırları. Satır: renkli ikon karosu · kalın kategori
 * başlığı / soluk somut kayıt (tek satır, "…" + title) · yaş ("12 gün geçti", önem renginde) · önem hapı · ok; altında
 * kategorinin geri kalanı ("+11 daha"). Satırın tamamı kaydın kendisine gider. `#dikkat` çapası (yan menü ve kahraman hapı).
 */
export function AttentionPanel({ rows, total, allHref, allLabel = "Tümünü gör", emptyAction }: { rows: AttentionRow[]; total: number; allHref?: string | null; allLabel?: string; emptyAction?: ReactNode }) {
  return (
    <section id="dikkat" data-tour="dikkat" className="kh-card kh-attn scroll-mt-24" aria-labelledby="kh-attn-title">
      <div className="kh-card-head">
        <span className="kh-ico lg t-rose kh-attn-mark" aria-hidden="true">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="kh-attn-title" className="kh-card-title">
            Dikkat gerektirenler
          </h2>
          <p className="kh-card-sub truncate">Öncelik sırasına göre, acil aksiyon bekleyen konular</p>
        </div>
        {allHref ? <SeeAll href={allHref} label={allLabel} pill /> : null}
      </div>
      {rows.length === 0 ? (
        <div className="kh-attn-empty">
          <span className="kh-ico lg t-mint" aria-hidden="true">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--heading)]">Şu an dikkat bekleyen iş yok</p>
            <p className="text-xs text-text-muted">Geciken kira, geciken görev, onay ya da riskli anlaşma oluşunca burada önem sırasıyla listelenir.</p>
          </div>
          {emptyAction}
        </div>
      ) : (
        <ul className="kh-attn-list" aria-label={`${total} konu`}>
          {rows.map((r) => {
            const ic = ATTN_ICON[r.id] ?? { icon: AlertTriangle, tone: "rose" as Tone };
            const pill = LEVEL_PILL[r.level];
            return (
              <li key={r.id}>
                <Link href={r.href} className={`kh-attn-row focus-ring lv-${r.level}`}>
                  <span className={`kh-ico t-${ic.tone}`} aria-hidden="true">
                    <ic.icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="kh-attn-label" title={r.label}>
                      {r.label}
                      {r.more ? <span className="kh-attn-more">{r.more}</span> : null}
                    </span>
                    <span className="kh-attn-hint" title={r.hint}>
                      {r.hint}
                    </span>
                  </span>
                  {r.age ? <span className={`kh-attn-meta ${r.overdueAge ? "" : "is-slot"}`}>{r.age}</span> : null}
                  <span className={`kh-lv t-${pill.tone}`}>
                    <span className="kh-lv-dot" aria-hidden="true" />
                    {pill.label}
                  </span>
                  <ChevronRight className="kh-attn-chev h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ================================ İLERLEME HALKASI ================================ */

/**
 * Halka (kurulum / ofis hedefi): altın degrade yay, ilk boyamada sıfırdan değerine çizilir (CSS `stroke-dashoffset`,
 * reduced-motion ve yumuşak gezinmede doğrudan son hâl). `pathLength=100`: yüzde doğrudan uzunluktur.
 */
export function ProgressRing({ pct, id, label, size = 132, children }: { pct: number; id: string; label: string; size?: number; children?: ReactNode }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="kh-ring" role="img" aria-label={label} style={{ width: size, height: size, ["--ring-to" as string]: String(100 - p) }}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id={`kh-ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="kh-ring-a" />
            <stop offset="1" className="kh-ring-b" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="50" className="kh-ring-track" />
        <circle cx="60" cy="60" r="50" pathLength={100} className="kh-ring-arc" stroke={`url(#kh-ring-${id})`} />
      </svg>
      <span className="kh-ring-center">{children}</span>
    </div>
  );
}

/* ================================ KURULUM / HEDEF ================================ */

export type SetupStepView = { id: string; title: string; done: boolean; next: boolean; href: string };

/** Fotoğrafsız villa çizimi (kurulum kartı; `getHeroPhoto("setup-villa")` yoksa): modern iki katlı ev, cam cephe, ağaç. */
export function VillaArt() {
  return (
    <svg viewBox="0 0 220 180" className="kh-villa" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="kh-villa-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="kv-sky-a" />
          <stop offset="1" className="kv-sky-b" />
        </linearGradient>
        <linearGradient id="kh-villa-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="kv-glass-a" />
          <stop offset="1" className="kv-glass-b" />
        </linearGradient>
      </defs>
      <rect width="220" height="180" fill="url(#kh-villa-sky)" />
      <circle cx="176" cy="40" r="16" className="kv-sun" />
      <path d="M0 150 C40 138 80 142 120 146 S190 150 220 140 V180 H0Z" className="kv-hill" />
      <rect x="54" y="62" width="128" height="10" rx="2" className="kv-slab" />
      <rect x="62" y="72" width="112" height="40" className="kv-wall" />
      <rect x="70" y="78" width="56" height="28" rx="2" fill="url(#kh-villa-glass)" />
      <path d="M84 78 V106 M98 78 V106 M112 78 V106" className="kv-mullion" />
      <rect x="134" y="78" width="32" height="28" rx="2" className="kv-lit" />
      <rect x="40" y="110" width="150" height="8" rx="2" className="kv-slab" />
      <rect x="48" y="118" width="134" height="34" className="kv-wall-2" />
      <rect x="56" y="124" width="70" height="28" rx="2" fill="url(#kh-villa-glass)" />
      <rect x="134" y="124" width="22" height="28" rx="2" className="kv-wood" />
      <rect x="160" y="126" width="16" height="12" rx="2" className="kv-lit" />
      <rect x="20" y="150" width="190" height="6" rx="3" className="kv-pool" />
      <circle cx="26" cy="118" r="18" className="kv-tree" />
      <circle cx="16" cy="132" r="12" className="kv-tree-2" />
      <rect x="24" y="128" width="4" height="24" className="kv-trunk" />
      <circle cx="204" cy="128" r="14" className="kv-tree-2" />
      <rect x="202" y="134" width="4" height="18" className="kv-trunk" />
    </svg>
  );
}

function SideArt({ photo }: { photo?: HeroPhotoSource | null }) {
  return (
    <div className="kh-setup-art" aria-hidden="true">
      {photo ? <img src={photo.src} srcSet={photo.srcSet} sizes="240px" alt="" width={photo.width} height={photo.height} loading="lazy" decoding="async" title={photo.title} /> : <VillaArt />}
    </div>
  );
}

/**
 * KURULUMUNU TAMAMLA (ilk ekran; kurulum %100 olana dek): halka (%), kalan adım cümlesi, en çok 4 adımlık kontrol listesi
 * (tamam: yeşil onay · sıradaki: altın halka + "Şimdi ekle" hapı · bekleyen: boş daire), sağda villa görseli.
 */
export function SetupCard({ percent, remaining, steps, photo }: { percent: number; remaining: number; steps: SetupStepView[]; photo?: HeroPhotoSource | null }) {
  return (
    <section className="kh-card kh-setup" aria-labelledby="kh-setup-title" data-kurulum="">
      <div className="kh-setup-main">
        <div className="kh-card-head">
          <span className="kh-ico t-brand" aria-hidden="true">
            <KurulumIcon className="h-[18px] w-[18px]" />
          </span>
          <h2 id="kh-setup-title" className="kh-card-title truncate">
            Kurulumunu tamamla
          </h2>
        </div>
        <div className="kh-setup-grid">
          <ProgressRing pct={percent} id="kurulum" label={`Kurulum %${percent} tamam`} size={116}>
            <span className="kh-ring-pct">%{percent}</span>
          </ProgressRing>
          <div className="min-w-0">
            <p className="kh-setup-sub">
              {remaining > 0 ? (
                <>
                  Daha verimli bir deneyim için <strong>{remaining}</strong> adım kaldı.
                </>
              ) : (
                "Zorunlu adımlar tamam."
              )}
            </p>
            <ul className="kh-steps">
              {steps.map((s) => (
                <li key={s.id} className={`kh-step ${s.done ? "is-done" : s.next ? "is-next" : ""}`}>
                  <span className="kh-step-mark" aria-hidden="true">
                    {s.done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  <Link href={s.href} className="kh-step-label focus-ring">
                    {s.title}
                    <span className="sr-only">{s.done ? " (tamamlandı)" : s.next ? " (sıradaki adım)" : " (bekliyor)"}</span>
                  </Link>
                  {s.next ? (
                    <Link href={s.href} className="kh-step-cta focus-ring press">
                      Şimdi ekle
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <SideArt photo={photo} />
    </section>
  );
}

/**
 * KURULUM SONRASI KART KABUĞU: "Kurulumunu tamamla" ile AYNI kutu (`kh-card kh-setup`, aynı ayrılmış yükseklik
 * `--kh-setup-h`, aynı sağ fotoğraf sütunu) — kurulum %100 olduğunda yerini alan kart düzeni kaydırmaz (CLS 0).
 * Başlıkta sağda kısa bir hap (ör. "15 gün kaldı"), gövdede halka + metin sütunu.
 */
function PostSetupShell({
  id,
  title,
  icon: Icon,
  tone,
  badge,
  ring,
  photo,
  kind,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  tone: Tone;
  badge?: string | null;
  ring: ReactNode;
  photo?: HeroPhotoSource | null;
  kind: string;
  children: ReactNode;
}) {
  return (
    <section className="kh-card kh-setup" aria-labelledby={id} data-kurulum-sonrasi={kind}>
      <div className="kh-setup-main">
        <div className="kh-card-head">
          <span className={`kh-ico t-${tone}`} aria-hidden="true">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <h2 id={id} className="kh-card-title min-w-0 flex-1 truncate">
            {title}
          </h2>
          {badge ? <span className="kh-goal-badge">{badge}</span> : null}
        </div>
        <div className="kh-setup-grid">
          {ring}
          <div className="kh-goal-body min-w-0 flex-1">{children}</div>
        </div>
      </div>
      <SideArt photo={photo} />
    </section>
  );
}

export type GoalCardView =
  | { state: "no-target" }
  | {
      state: "tracking";
      ringPct: number;
      pct: number;
      /** Biçimlenmiş gerçekleşme (₺ ya da "3 kapanış"); hiçbir zaman kısaltılmaz. */
      actualText: string;
      targetText: string;
      /** "≈ ₺3.100.000" (yalnız tutar hedefinde, yeterli veride). */
      estimateText: string | null;
      exceeded: boolean;
    };

/** Halka merkezi: yüzde ya da hedef yokken "—". */
function GoalRing({ id, view, label }: { id: string; view: GoalCardView; label: string }) {
  if (view.state === "no-target") {
    return (
      <ProgressRing pct={0} id={id} label={label} size={116}>
        <span className="kh-ring-pct text-text-faint">—</span>
      </ProgressRing>
    );
  }
  return (
    <ProgressRing pct={view.ringPct} id={id} label={label} size={116}>
      <span className="kh-ring-pct">%{view.pct}</span>
    </ProgressRing>
  );
}

function NoTarget({ text, href, canSet }: { text: string; href: string; canSet: boolean }) {
  return (
    <div className="kh-goal-empty">
      <p className="kh-goal-note">{text}</p>
      {canSet ? (
        <Link href={href} className="kh-step-cta focus-ring press">
          Hedef belirleyin
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        <p className="kh-goal-note">Hedefi ofis yöneticiniz belirler.</p>
      )}
    </div>
  );
}

function Tracking({ view, href }: { view: Extract<GoalCardView, { state: "tracking" }>; href: string }) {
  return (
    <>
      <Link href={href} className="kh-goal-value focus-ring">
        {view.actualText}
      </Link>
      <p className="kh-goal-target">Hedef {view.targetText}</p>
      {view.exceeded ? (
        <p className="kh-goal-pace is-ok">Hedef aşıldı</p>
      ) : view.estimateText ? (
        <p className="kh-goal-pace" title="Tahmin: bu ayki günlük ortalama hızla ay sonuna doğrusal projeksiyon">
          <span className="kh-goal-est">Tahmin</span>
          <span className="kh-goal-pace-text">Bu hızla ay sonu {view.estimateText}</span>
        </p>
      ) : null}
    </>
  );
}

/**
 * BU AYIN HEDEFİ (yönetim, ofis geneli; kurulum tamamlanınca aynı yerde): ofis cirosu / hedef halkası (altın), etiketli
 * ay sonu TAHMİNİ, kalan gün hapı, en çok katkı veren danışman (baş harfli avatar). Hedef yoksa "Hedef belirleyin".
 */
export function OfficeGoalCard({
  view,
  daysLeft,
  top,
  href,
  canSet,
  photo,
}: {
  view: GoalCardView;
  daysLeft: number;
  top: { name: string; amountText: string; href: string } | null;
  href: string;
  canSet: boolean;
  photo?: HeroPhotoSource | null;
}) {
  return (
    <PostSetupShell
      id="kh-goal-title"
      kind="ofis-hedefi"
      title="Bu ayın hedefi"
      icon={Goal}
      tone="gold"
      badge={`${daysLeft} gün kaldı`}
      photo={photo}
      ring={<GoalRing id="hedef" view={view} label={view.state === "tracking" ? `Bu ayın ofis hedefinin %${view.pct} kadarı gerçekleşti` : "Bu ay için hedef belirlenmedi"} />}
    >
      {view.state === "no-target" ? (
        <NoTarget text="Bu ay için ofis hedefi belirlenmedi. Hedef girildiğinde gerçekleşme ve ay sonu tahmini burada görünür." href={href} canSet={canSet} />
      ) : (
        <>
          <Tracking view={view} href={href} />
          {top ? (
            <Link href={top.href} className="kh-goal-top focus-ring" title={`En çok katkı: ${top.name} · ${top.amountText}`}>
              <Avatar name={top.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="kh-goal-top-k">En çok katkı</span>
                <span className="kh-goal-top-n">{top.name}</span>
              </span>
              <span className="kh-goal-top-v">{top.amountText}</span>
            </Link>
          ) : null}
        </>
      )}
    </PostSetupShell>
  );
}

/**
 * KİŞİSEL HEDEFİM (danışman / takım lideri / "Benim işlerim"): kazanç (yoksa kapanış) hedefi halkası, kalan gün, bu
 * haftanın en önemli adımı (en yakın vadeli — öncelikli olan önde — açık görevim; kaydın kendisine gider).
 */
export function PersonalGoalCard({
  view,
  daysLeft,
  next,
  href,
  canSet,
  photo,
}: {
  view: GoalCardView;
  daysLeft: number;
  next: { title: string; href: string; when: string } | null;
  href: string;
  canSet: boolean;
  photo?: HeroPhotoSource | null;
}) {
  return (
    <PostSetupShell
      id="kh-goal-title"
      kind="kisisel-hedef"
      title="Kişisel hedefim"
      icon={Target}
      tone="gold"
      badge={`${daysLeft} gün kaldı`}
      photo={photo}
      ring={<GoalRing id="hedef" view={view} label={view.state === "tracking" ? `Bu ayki kişisel hedefinizin %${view.pct} kadarı gerçekleşti` : "Bu ay için kişisel hedef yok"} />}
    >
      {view.state === "no-target" ? (
        <NoTarget text="Bu ay için kişisel hedefiniz yok. Hedef girildiğinde ilerlemeniz burada görünür." href={href} canSet={canSet} />
      ) : (
        <Tracking view={view} href={href} />
      )}
      {next ? (
        <Link href={next.href} className="kh-goal-next focus-ring" title={next.title}>
          <span className="kh-goal-top-k">Bu haftanın adımı · {next.when}</span>
          <span className="kh-goal-next-t">{next.title}</span>
        </Link>
      ) : null}
    </PostSetupShell>
  );
}

export type CloseStepView = { key: string; label: string; status: "done" | "todo" | "unknown"; href: string };

/**
 * AY SONU KAPANIŞI (muhasebe; kurulum tamamlanınca aynı yerde): geçen ayın kapanış kontrol listesi (`lib/finance/month-close`)
 * — halka tamamlanan adım oranı, en çok 4 adım (yapılacak olanlar önde; ilk yapılacakta "Aç"), kilitliyse "kapatıldı".
 */
export function MonthCloseHomeCard({
  monthName,
  done,
  total,
  closed,
  steps,
  href,
  photo,
}: {
  monthName: string;
  done: number;
  total: number;
  closed: boolean;
  steps: CloseStepView[];
  href: string;
  photo?: HeroPhotoSource | null;
}) {
  const pct = closed ? 100 : Math.round((done / Math.max(1, total)) * 100);
  const firstTodo = steps.find((s) => s.status === "todo")?.key ?? null;
  return (
    <PostSetupShell
      id="kh-close-title"
      kind="ay-sonu-kapanisi"
      title="Ay sonu kapanışı"
      icon={ClipboardCheck}
      tone="brand"
      badge={monthName}
      photo={photo}
      ring={
        <ProgressRing pct={pct} id="kapanis" label={closed ? `${monthName} dönemi kapatıldı` : `${monthName} kapanışı: ${done}/${total} adım tamam`} size={116}>
          <span className="kh-ring-pct">{closed ? "%100" : `${done}/${total}`}</span>
        </ProgressRing>
      }
    >
      {closed ? (
        <div className="kh-goal-empty">
          <p className="kh-goal-note">{monthName} dönemi kilitlendi; bu aya kayıt eklenemez ve değiştirilemez.</p>
          <Link href={href} className="kh-step-cta focus-ring press">
            Dönem kapanışı
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <ul className="kh-steps">
          {steps.slice(0, 4).map((s) => (
            <li key={s.key} className={`kh-step ${s.status === "done" ? "is-done" : s.key === firstTodo ? "is-next" : ""}`}>
              <span className="kh-step-mark" aria-hidden="true">
                {s.status === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              <Link href={s.href} className="kh-step-label focus-ring" title={s.label}>
                {s.label}
                <span className="sr-only">{s.status === "done" ? " (tamam)" : s.status === "todo" ? " (yapılacak)" : " (okunamadı)"}</span>
              </Link>
              {s.key === firstTodo ? (
                <Link href={s.href} className="kh-step-cta focus-ring press">
                  Aç
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PostSetupShell>
  );
}

/* ================================ BUGÜN OFİSTE OLANLAR ================================ */

export type TeamTodayView = { id: string; name: string; avatarUrl: string | null; avatarPreset: string | null; status: string; when: string; today: boolean; href: string };

/**
 * BUGÜN OFİSTE OLANLAR (v5): bugün sistemde iş yapan ekip (denetim kaydına göre; "çevrimiçi" iddiası yok) — yeşil "N kişi
 * bugün aktif" satırı, yuvarlak avatar (fotoğraf ya da yumuşak renkli baş harf), ad, son faaliyet ("İlan güncelliyor").
 * Bugün kimse yoksa son 7 günün son faaliyetleri zamanıyla ("Dün · Müşteri kaydı"). Yatay sıra; sığmazsa yatay kaydırma.
 */
export function TeamToday({ people, total, allHref }: { people: TeamTodayView[]; total: number; allHref: string }) {
  return (
    <section className="kh-card kh-team" aria-labelledby="kh-team-title">
      <div className="kh-card-head">
        <span className="kh-ico t-mint" aria-hidden="true">
          <OfisteIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="kh-team-title" className="kh-card-title truncate">
            Bugün ofiste olanlar
          </h2>
          <p className={`kh-card-sub kh-team-sub ${total > 0 ? "" : "is-quiet"}`}>
            <span className="kh-live-dot" aria-hidden="true" />
            <span className="truncate">{total > 0 ? `${total.toLocaleString("tr-TR")} kişi bugün aktif` : people.length > 0 ? "Bugün henüz kayıt yok · son faaliyetler" : "Bugün henüz kayıt yok"}</span>
          </p>
        </div>
        <SeeAll href={allHref} pill />
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-text-muted">Ekip sisteme kayıt girdikçe burada görünür.</p>
      ) : (
        <ul className="kh-team-row">
          {people.map((p) => (
            <li key={p.id}>
              <Link href={p.href} className={`kh-person focus-ring ${p.today ? "is-today" : ""}`} title={`${p.name} · ${p.status} · ${p.when}`}>
                <span className="kh-person-av">
                  <Avatar name={p.name} src={p.avatarUrl} preset={p.avatarPreset} size="lg" />
                  {p.today ? <span className="kh-person-dot" aria-hidden="true" /> : null}
                </span>
                <span className="kh-person-name">{p.name}</span>
                <span className="kh-person-status">{p.today ? p.status : `${p.when} · ${p.status}`}</span>
              </Link>
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
      <span className="skeleton h-12 w-12 rounded-[var(--radius-control)]" />
      <div className="kh-kpi-main space-y-2">
        <span className="skeleton block h-3.5 w-24 rounded-md" />
        <span className="skeleton block h-7 w-28 rounded-md" />
        <span className="skeleton block h-4 w-14 rounded-md" />
      </div>
      <span className="kh-kpi-spark skeleton block h-10 rounded-md" />
    </div>
  );
}

/** KPI ikonları (referans: altın para · mavi belge · pembe kişiler · yeşil kişi · mavi telefon). */
export const KPI_ICONS = { revenue: Coins, deals: FileText, demands: Users, customers: UserRound, calls: PhoneIncoming } as const;
