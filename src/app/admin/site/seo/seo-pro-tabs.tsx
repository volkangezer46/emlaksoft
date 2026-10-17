import Link from "@/components/ui/smart-link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Braces,
  CircleGauge,
  EyeOff,
  FileSearch,
  Gauge,
  Hourglass,
  KeyRound,
  Layers,
  ListChecks,
  MapPinned,
  Search,
  Sparkles,
  Swords,
  Target,
  TrendingDown,
  Wrench,
} from "lucide-react";
import { Ring } from "@/components/ui/premium/charts";
import { Sparkline } from "@/components/ui/premium/sparkline";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTimeTr } from "@/lib/format";
import { getPlatformSetting } from "@/lib/platform-settings";
import { gscKeywordPairs } from "@/lib/google/db";
import { readConnectionView } from "@/lib/google/read";
import { serviceCard } from "@/lib/google/view-model";
import { listPublishedGuidesForPage } from "@/lib/guides/store";
import { isThinGuide } from "@/lib/guides/schema";
import { psiKeyStatus } from "@/lib/perf/store";
import { seoHref, seoPageEditorHref } from "@/lib/seo/admin-links";
import { AI_ANSWER_BOTS, AI_TRAINING_BOTS, geoReadiness } from "@/lib/seo/geo";
import { loadHubIndex } from "@/lib/seo/hubs/data";
import { hubDecision, hubTitle } from "@/lib/seo/hubs/rules";
import { aggregateQueries, cannibalization, opportunities, winnersLosers } from "@/lib/seo/keywords";
import { getSeoPage } from "@/lib/seo/registry";
import { CATEGORY_LABEL, CHECK_LABEL, SCORE_CATEGORIES, scoreGrade, type ScoreCategory } from "@/lib/seo/score";
import { readHubSettings, readIndexNow, readSeoSettingsFresh } from "@/lib/seo/store";
import { AUTOPILOT_KEY, AUTOPILOT_KINDS, AUTOPILOT_KIND_LABEL, parseAutopilot } from "@/lib/site-issues/autopilot";
import { OpsCard, OpsKpis, OpsList, OpsRow, type OpsKpi } from "../../_components/ops-kit";
import { loadScoreView } from "./seo-pro-data";
import { HubPathToggle, HubSettingsForm, RecomputeScoreButton } from "./seo-pro-panels";

/**
 * SEO merkezi (gelişmiş) sekmeleri — sunucu bileşenleri. Her sayı bir hedefe bağlıdır; veri yoksa sayı yerine
 * anlamlı boş durum ve kurulum bağlantısı çizilir (sahte puan yok). Tahmini değerler "tahmini" etiketlidir.
 */

const n = (v: number) => v.toLocaleString("tr-TR");
const pos = (v: number | null) => (v === null ? "-" : v.toLocaleString("tr-TR", { maximumFractionDigits: 1 }));
const catTone = (v: number | null): OpsKpi["tone"] => (v === null ? "slate" : v >= 85 ? "mint" : v >= 60 ? "amber" : "rose");

function ScoreBadge({ value }: { value: number | null }) {
  const g = scoreGrade(value);
  return (
    <span className={`inline-flex min-w-11 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${value === null ? "tone-neutral" : value >= 75 ? "tone-success" : value >= 50 ? "tone-warning" : "tone-danger"}`} title={g.label}>
      {value === null ? "-" : value}
    </span>
  );
}

function NoData({ title, children, href, label }: { title: string; children: string; href?: string; label?: string }) {
  return <EmptyState title={title} description={children} action={href ? { href, label: label ?? "Aç" } : undefined} variant="compact" />;
}

/* ================================ Genel puan ================================ */

export async function ScoreOverviewTab({ canSensitive }: { canSensitive: boolean }) {
  const [view, gsc, psi, s, indexNow] = await Promise.all([
    loadScoreView(),
    readConnectionView().then((v) => serviceCard(v, "gsc")).catch(() => null),
    psiKeyStatus().catch(() => ({ configured: false, readable: false })),
    readSeoSettingsFresh(),
    readIndexNow(),
  ]);
  const { site, stored, pages, recommendations } = view;
  const setup = [
    { label: "Search Console bağlantısı", ok: Boolean(gsc && gsc.status !== "bagli_degil"), href: "/admin/site/baglantilar", hint: "Anahtar kelime takibi ve sorgu bazlı öneriler için" },
    { label: "PageSpeed API anahtarı", ok: psi.configured, href: "/admin/site/hiz", hint: "Yoksa performans puanı sayfa ağırlığından tahmin edilir" },
    { label: "Google doğrulama kodu", ok: Boolean(s.global.verification.google), href: seoHref("ayarlar", "genel", {}, "vGoogle"), hint: "Search Console mülk doğrulaması" },
    { label: "IndexNow (Bing, Yandex)", ok: indexNow.enabled, href: seoHref("ayarlar"), hint: "Değişen sayfaları anında bildirir" },
    { label: "llms.txt (yapay zekâ arama)", ok: s.robots.llmsTxtEnabled, href: seoHref("geo"), hint: "Yanıt motorlarına düz metin site özeti" },
  ];
  if (!site) {
    return (
      <div className="space-y-6">
        <NoData title="SEO puanı için henüz robot verisi yok" href={seoHref("tarama")} label="Teknik tarama: robotu çalıştır">
          Puan yalnız gerçek tarama sonucundan hesaplanır. Robot her gün 07:20’de (TR) çalışır; süper admin şimdi de çalıştırabilir. İlk koşudan sonra burada sayfa, kategori ve site puanı görünür.
        </NoData>
        <SetupCard items={setup} />
      </div>
    );
  }
  const history = stored?.history ?? [];
  const series = history.map((h) => h.total);
  const prev = history.length >= 2 ? history[history.length - 2]!.total : null;
  const delta = prev === null ? null : site.total - prev;
  const grade = scoreGrade(site.total);
  const kpis: OpsKpi[] = SCORE_CATEGORIES.map((c) => ({
    key: c,
    title: CATEGORY_LABEL[c],
    value: site.categories[c] === null ? "Uygulanamaz" : `${site.categories[c]}/100`,
    href: seoHref("sayfalar", "taranan", { kategori: c }),
    icon: CAT_ICON[c],
    tone: catTone(site.categories[c]),
    caption: c === "performans" && site.perfEstimated ? "Kısmen tahmini (PSI yok)" : c === "tazelik" && site.categories[c] === null ? "lastmod yok" : `En zayıf sayfalar →`,
    series: history.map((h) => h.categories[c]).filter((v): v is number => v !== null),
    seriesLabel: `${CATEGORY_LABEL[c]} puanı geçmişi`,
  }));
  const worst = [...pages].sort((a, b) => a.score.total - b.score.total || a.score.path.localeCompare(b.score.path)).slice(0, 5);
  return (
    <div className="space-y-6">
      <section className="kh-card" aria-label="SEO optimizasyon puanı">
        <div className="grid gap-6 p-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
          <Link href={seoHref("sayfalar", "taranan")} className="focus-ring mx-auto block rounded-full" aria-label={`Site SEO puanı ${site.total}/100, ${grade.label}. Sayfalara git`}>
            <Ring pct={site.total} size={148} stroke={12} tone={site.total >= 75 ? "success" : site.total >= 50 ? "warn" : "danger"} ariaLabel={`SEO puanı ${site.total}/100`}>
              <span className="flex flex-col items-center">
                <span className="font-display text-4xl font-extrabold tabular-nums text-ink-950">{site.total}</span>
                <span className="text-xs font-semibold text-text-muted">/ 100</span>
              </span>
            </Ring>
          </Link>
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">SEO optimizasyon puanı</p>
            <p className="font-display text-2xl font-extrabold text-ink-950">
              {grade.label}
              {delta !== null && delta !== 0 ? (
                <span className={`ml-3 inline-flex items-center gap-1 align-middle text-sm font-bold ${delta > 0 ? "text-success-strong" : "text-danger-600"}`}>
                  {delta > 0 ? <ArrowUpRight className="h-4 w-4" aria-hidden /> : <ArrowDownRight className="h-4 w-4" aria-hidden />}
                  {delta > 0 ? "+" : ""}
                  {delta} önceki hesaba göre
                </span>
              ) : null}
            </p>
            <p className="text-sm text-text-muted">
              {n(site.pages)} taranan sayfadan ağırlıklı ortalama (ana sayfa ×3, sitemap sayfaları ×1, gizli sayfalar ×0,25)
              {site.penalty > 0 ? `; site geneli kritik sorun cezası −${site.penalty}` : ""}.{" "}
              {stored ? `Son kayıt: ${formatDateTimeTr(stored.at)}.` : "Henüz geçmişe kaydedilmedi (robotun bir sonraki koşusunda kaydedilir)."}
            </p>
            {series.length >= 2 ? (
              <div className="max-w-md">
                <Sparkline data={series} tone="brand" unit="hesap" label={`Son ${series.length} hesapta puan: en düşük ${Math.min(...series)}, en yüksek ${Math.max(...series)}, son ${series[series.length - 1]}`} height={44} />
              </div>
            ) : (
              <p className="text-xs text-text-faint">Trend çizgisi en az iki hesaptan sonra görünür.</p>
            )}
            <RecomputeScoreButton />
          </div>
        </div>
      </section>

      <OpsKpis items={kpis} label="Kategori puanları" />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <OpsCard icon={TrendingDown} tone="rose" title="Neden düştü?" sub="Son iki hesap arasında puanı en çok düşen sayfalar ve yeni başarısız kontroller">
          {!stored || stored.drop.length === 0 ? (
            <p className="py-3 text-sm text-text-muted">{stored ? "Son hesapta 3 puandan fazla düşen sayfa yok." : "Karşılaştırma için en az iki kayıtlı hesap gerekir."}</p>
          ) : (
            <OpsList label="Puanı düşen sayfalar">
              {stored.drop.map((d) => (
                <OpsRow
                  key={d.url}
                  primary={pathOf(d.url)}
                  href={seoHref("sayfalar", "taranan", { yol: pathOf(d.url) })}
                  secondary={d.newlyFailed.length ? d.newlyFailed.map((f) => CHECK_LABEL[f] ?? f).join(" · ") : "Kısmi düşüş (aynı kontrollerde)"}
                  right={
                    <span className="text-sm font-bold tabular-nums text-danger-600">
                      {d.before} → {d.after}
                    </span>
                  }
                />
              ))}
            </OpsList>
          )}
        </OpsCard>
        <OpsCard icon={Target} tone="brand" title="En çok kazandıracak işler" sub="Etki × kolaylık sırasıyla; tamamı Öneriler sekmesinde" right={<Link href={seoHref("oneriler")} className="text-sm font-semibold text-brand-700 hover:underline">Tümü →</Link>}>
          {recommendations.length === 0 ? (
            <p className="py-3 text-sm text-text-muted">Bekleyen öneri yok.</p>
          ) : (
            <OpsList label="Öncelikli öneriler">
              {recommendations.slice(0, 5).map((r) => (
                <OpsRow key={r.id} primary={r.title} href={r.href} secondary={r.detail} right={<PriorityPill impact={r.impact} ease={r.ease} />} />
              ))}
            </OpsList>
          )}
        </OpsCard>
      </div>

      <OpsCard icon={ListChecks} tone="amber" title="En düşük puanlı sayfalar" sub="Tıklayınca sayfanın kontrol listesi açılır">
        <OpsList label="En düşük puanlı sayfalar">
          {worst.map(({ score }) => (
            <OpsRow
              key={score.url}
              primary={score.path}
              href={seoHref("sayfalar", "taranan", { yol: score.path })}
              secondary={score.checks.filter((c) => c.ratio < 1).slice(0, 4).map((c) => c.label).join(" · ") || "Tüm kontroller geçti"}
              right={<ScoreBadge value={score.total} />}
            />
          ))}
        </OpsList>
      </OpsCard>
      <SetupCard items={setup} />
      {!canSensitive ? <p className="text-xs text-text-muted">Ayar değiştiren işlemler yalnız süper admin içindir.</p> : null}
    </div>
  );
}

const CAT_ICON: Record<ScoreCategory, OpsKpi["icon"]> = { teknik: Wrench, sayfaIci: FileSearch, yapisal: Braces, performans: Gauge, tazelik: Hourglass };

function SetupCard({ items }: { items: { label: string; ok: boolean; href: string; hint: string }[] }) {
  return (
    <OpsCard icon={CircleGauge} tone="slate" title="Kurulum" sub="Eksik olan her kaynak puanın bir bölümünü tahmine ya da “uygulanamaz”a düşürür">
      <OpsList label="Kurulum durumu">
        {items.map((i) => (
          <OpsRow key={i.label} primary={i.label} href={i.href} secondary={i.hint} right={<StatusBadge tone={i.ok ? "success" : "attention"}>{i.ok ? "Hazır" : "Eksik"}</StatusBadge>} />
        ))}
      </OpsList>
    </OpsCard>
  );
}

function PriorityPill({ impact, ease }: { impact: number; ease: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" title={`Etki ${impact}/5 × kolaylık ${ease}/5`}>
      <span className="rounded-full tone-neutral px-2 py-0.5 font-semibold">Etki {impact}</span>
      <span className="rounded-full tone-neutral px-2 py-0.5 font-semibold">Kolaylık {ease}</span>
    </span>
  );
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

/* ================================ Sayfalar > Taranan ================================ */

export async function CrawledPagesSection({ kategori, yol }: { kategori?: string; yol?: string }) {
  const view = await loadScoreView();
  if (!view.ctx) {
    return (
      <NoData title="Taranan sayfa yok" href={seoHref("tarama")} label="Robotu çalıştır">
        Robot sitemap’teki ve iç bağlantılarla bulduğu sayfaları tarar; ilk koşudan sonra her sayfanın puanı ve kontrol listesi burada görünür.
      </NoData>
    );
  }
  const cat = (SCORE_CATEGORIES as readonly string[]).includes(kategori ?? "") ? (kategori as ScoreCategory) : null;
  const rows = [...view.pages].sort((a, b) => {
    const av = cat ? (a.score.categories[cat] ?? 101) : a.score.total;
    const bv = cat ? (b.score.categories[cat] ?? 101) : b.score.total;
    return av - bv || a.score.path.localeCompare(b.score.path);
  });
  return (
    <div className="space-y-4">
      <nav aria-label="Kategoriye göre sırala" className="flex flex-wrap gap-2">
        <FilterChip href={seoHref("sayfalar", "taranan")} active={!cat} label="Toplam puan" />
        {SCORE_CATEGORIES.map((c) => (
          <FilterChip key={c} href={seoHref("sayfalar", "taranan", { kategori: c })} active={cat === c} label={CATEGORY_LABEL[c]} />
        ))}
      </nav>
      <p className="text-xs text-text-muted">
        {n(rows.length)} sayfa · robot taraması {formatDateTimeTr(view.ctx.snapAt)} · {cat ? `${CATEGORY_LABEL[cat]} puanına göre en düşükten` : "toplam puana göre en düşükten"} sıralı. Satırı açınca kontroller ve düzeltme önerisi görünür.
      </p>
      <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
        {rows.map(({ score, snap }) => {
          const failing = score.checks.filter((c) => c.ratio < 1);
          const registry = Boolean(getSeoPage(score.path));
          return (
            <li key={score.url} id={`p-${encodeURIComponent(score.path)}`}>
              <details open={yol === score.path} className="group">
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                  <ScoreBadge value={score.total} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-950" title={score.path}>
                    {score.path}
                  </span>
                  <span className="flex flex-wrap gap-1 text-xs text-text-muted">
                    {SCORE_CATEGORIES.map((c) => (
                      <span key={c} title={CATEGORY_LABEL[c]} className="tabular-nums">
                        {CATEGORY_LABEL[c].slice(0, 3)} {score.categories[c] ?? "-"}
                      </span>
                    ))}
                  </span>
                  {snap.noindex ? <StatusBadge tone="neutral">noindex</StatusBadge> : null}
                  <span className="text-xs text-text-muted">{failing.length === 0 ? "Tümü geçti" : `${failing.length} kontrol`}</span>
                </summary>
                <div className="space-y-2 px-4 pb-4">
                  <ul className="grid gap-1.5 text-xs md:grid-cols-2">
                    {score.checks.map((c) => (
                      <li key={c.id} className="flex items-start gap-2">
                        <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${c.ratio >= 1 ? "bg-success-strong" : c.ratio >= 0.5 ? "bg-amber-500" : "bg-danger-600"}`} />
                        <span>
                          <span className="font-semibold text-ink-950">{c.label}</span> <span className="text-text-muted">· {c.detail}</span>
                          {c.estimated ? <span className="ml-1 rounded tone-neutral px-1 text-xs">tahmini</span> : null}
                          {c.ratio < 1 && c.fix ? <span className="block text-text-muted">→ {c.fix}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <a href={score.url} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">Sayfayı aç</a>
                    {registry ? (
                      <Link href={seoPageEditorHref(score.path)} className="font-semibold text-brand-700 hover:underline">SEO kaydını düzenle</Link>
                    ) : null}
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold touch:min-h-11 ${active ? "border-brand-600 bg-brand-600/10 text-brand-700" : "border-line text-text-muted hover:text-ink-950"}`}
    >
      {label}
    </Link>
  );
}

/** Vitrin sekmesi için: ofis slug'ı → robotun o ofisin vitrin sayfalarına verdiği puanlar. */
export async function vitrinPageScores(): Promise<Map<string, number[]>> {
  const view = await loadScoreView();
  const map = new Map<string, number[]>();
  for (const { score } of view.pages) {
    const m = /^\/vitrin\/([^/]+)/.exec(score.path);
    if (m) map.set(m[1]!, [...(map.get(m[1]!) ?? []), score.total]);
  }
  return map;
}

/* ================================ Öneriler ve düzeltmeler ================================ */

export async function RecommendationsTab() {
  const [view, autopilotRaw] = await Promise.all([loadScoreView(), getPlatformSetting(AUTOPILOT_KEY).catch(() => null)]);
  const ap = parseAutopilot(autopilotRaw);
  const recs = view.recommendations;
  return (
    <div className="space-y-6">
      <OpsCard
        icon={Wrench}
        tone="mint"
        title="Otomatik düzeltmeler (Otopilot)"
        sub="Robot bulguları Kokpit kuyruğuna önce/sonra farkıyla düşer: tek tıkla taslağa alınır ya da aşağıdaki türler gece kendiliğinden hazırlanır. Taslak canlıyı değiştirmez; her işlem kayıtlıdır ve SEO geçmişinden geri alınır."
        right={
          <Link href="/admin/site?alan=seo" className="text-sm font-semibold text-brand-700 hover:underline">
            Kuyruk ve Otopilot ayarı →
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-2 py-2 text-sm">
          <StatusBadge tone={ap.enabled ? "success" : "neutral"}>{ap.enabled ? "Otopilot açık" : "Otopilot kapalı"}</StatusBadge>
          <StatusBadge tone={ap.publish ? "attention" : "neutral"}>{ap.publish ? "Taslaklar kendiliğinden yayınlanır" : "Yayın insan onayıyla"}</StatusBadge>
        </div>
        <OpsList label="Otomatik uygulanabilen düzeltme türleri">
          {AUTOPILOT_KINDS.map((k) => (
            <OpsRow key={k} primary={AUTOPILOT_KIND_LABEL[k]} secondary={k} right={<StatusBadge tone={ap.enabled && ap.kinds.includes(k) ? "success" : "neutral"}>{ap.enabled && ap.kinds.includes(k) ? "Otomatik" : "Elle (tek tık)"}</StatusBadge>} />
          ))}
        </OpsList>
        <p className="pt-2 text-xs text-text-muted">Beyaz şapka: anahtar kelime doldurma, gizleme (cloaking), sahte puan/yorum ve otomatik noindex yapılmaz. Riskli değişiklikler (canonical, noindex, adres) yalnız öneri olarak gösterilir.</p>
      </OpsCard>

      <OpsCard icon={Target} tone="brand" title={`Öncelikli öneriler (${recs.length})`} sub="Gerçek sinyallerden: sayfa puanı kontrolleri, Search Console fırsatları ve yamyamlık. Öncelik = etki × kolaylık.">
        {recs.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">{view.ctx ? "Bekleyen öneri yok: tüm kontroller geçti." : "Öneri için robot verisi gerekir (Teknik tarama)."}</p>
        ) : (
          <OpsList label="Öneriler">
            {recs.map((r) => (
              <OpsRow
                key={r.id}
                primary={r.title}
                href={r.href}
                secondary={
                  <>
                    {r.detail}
                    {r.estimate ? <span className="ml-1 rounded tone-neutral px-1 text-xs font-semibold">tahmini</span> : null}
                    {r.estimate ? <span className="block">{r.estimate}</span> : null}
                    <span className="block font-semibold text-brand-700">{r.hrefLabel} →</span>
                  </>
                }
                right={<PriorityPill impact={r.impact} ease={r.ease} />}
              />
            ))}
          </OpsList>
        )}
      </OpsCard>
    </div>
  );
}

/* ================================ Anahtar kelimeler ================================ */

export async function KeywordsAnalysis() {
  const conn = await readConnectionView().catch(() => null);
  const card = conn ? serviceCard(conn, "gsc") : null;
  if (!card || card.status === "bagli_degil") {
    return (
      <NoData title="Search Console bağlı değil" href="/admin/site/baglantilar" label="Search Console’u bağla">
        Anahtar kelime takibi yalnız Google’ın gerçek verisiyle çalışır (sorgu, sayfa, tıklama, gösterim, pozisyon). Bağlantıdan sonra veriler her gün 06:10’da (TR) çekilir. Bağlantı yokken uydurma veri gösterilmez.
      </NoData>
    );
  }
  const kw = await gscKeywordPairs(28);
  if (!kw.available) {
    return (
      <NoData title="Anahtar kelime özeti kurulum bekliyor">
        Veritabanı fonksiyonu (migration 20261025020000_seo_gsc_keyword_pairs) uygulanınca kazanan/kaybeden, fırsat ve yamyamlık analizi burada görünür. Ham performans tabloları “Performans” bölümünde çalışmaya devam eder.
      </NoData>
    );
  }
  if (kw.rows.length === 0) {
    return <NoData title="Henüz sorgu verisi yok">Search Console bağlı; ilk senkrondan sonra (Google verisi 2-3 gün gecikir) sorgular burada görünür.</NoData>;
  }
  const rows = aggregateQueries(kw.rows);
  const { winners, losers } = winnersLosers(rows);
  const opps = opportunities(rows);
  const cannibals = cannibalization(kw.rows);
  const tot = rows.reduce((a, r) => ({ c: a.c + r.clicks, i: a.i + r.impressions, pc: a.pc + r.prevClicks, pi: a.pi + r.prevImpressions }), { c: 0, i: 0, pc: 0, pi: 0 });
  const perf = seoHref("kelimeler", "performans");
  const kpis: OpsKpi[] = [
    { key: "sorgu", title: "Sorgu", value: n(rows.length), href: `${perf}&alt=sorgular`, icon: KeyRound, tone: "brand", caption: "Son 28 gün (sorgu × sayfa)" },
    { key: "tik", title: "Tıklama", value: n(tot.c), href: `${perf}&alt=sorgular`, icon: Search, tone: "mint", caption: `Önceki 28 gün ${n(tot.pc)}` },
    { key: "gos", title: "Gösterim", value: n(tot.i), href: `${perf}&alt=sorgular`, icon: Layers, tone: "sky", caption: `Önceki 28 gün ${n(tot.pi)}` },
    { key: "firsat", title: "Fırsat (4–20. sıra)", value: n(opps.length), href: "#firsatlar", icon: Sparkles, tone: "amber", caption: "Yüksek gösterimli" },
    { key: "yamyam", title: "Yamyamlık", value: n(cannibals.length), href: "#yamyamlik", icon: Swords, tone: cannibals.length ? "rose" : "slate", caption: "Aynı aramada birden çok sayfa" },
  ];
  const moverRow = (m: (typeof winners)[number]) => (
    <OpsRow
      key={m.query}
      primary={m.query}
      href={m.topPage}
      secondary={`${pathOf(m.topPage)} · ${n(m.impressions)} gösterim · ${n(m.clicks)} tıklama`}
      right={
        <span className={`text-sm font-bold tabular-nums ${m.delta > 0 ? "text-success-strong" : "text-danger-600"}`}>
          {pos(m.prevPosition)} → {pos(m.position)}
        </span>
      }
    />
  );
  return (
    <div className="space-y-6">
      <OpsKpis items={kpis} label="Anahtar kelime özeti" />
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <OpsCard icon={ArrowUpRight} tone="mint" title="Yükselenler" sub="Önceki 28 güne göre ortalama pozisyonu iyileşen sorgular (iki dönemde de ≥20 gösterim)">
          {winners.length === 0 ? <p className="py-3 text-sm text-text-muted">Belirgin yükselen sorgu yok.</p> : <OpsList label="Yükselen sorgular">{winners.map(moverRow)}</OpsList>}
        </OpsCard>
        <OpsCard icon={ArrowDownRight} tone="rose" title="Düşenler" sub="Ortalama pozisyonu kötüleşen sorgular">
          {losers.length === 0 ? <p className="py-3 text-sm text-text-muted">Belirgin düşen sorgu yok.</p> : <OpsList label="Düşen sorgular">{losers.map(moverRow)}</OpsList>}
        </OpsCard>
      </div>
      <OpsCard id="firsatlar" icon={Sparkles} tone="amber" title="Fırsatlar" sub="4–20. sıradaki yüksek gösterimli sorgular. Ek tıklama, ilk 3'e çıkılırsa genel tıklama oranı eğrisinden TAHMİNDİR.">
        {opps.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">4–20. sırada en az 50 gösterimli sorgu yok.</p>
        ) : (
          <OpsList label="Fırsat sorguları">
            {opps.map((o) => (
              <OpsRow
                key={o.query}
                primary={o.query}
                href={getSeoPage(pathOf(o.topPage)) ? seoPageEditorHref(pathOf(o.topPage)) : o.topPage}
                secondary={`${pathOf(o.topPage)} · ${pos(o.position)}. sıra · ${n(o.impressions)} gösterim · ${n(o.clicks)} tıklama`}
                right={<span className="text-xs font-semibold text-text-muted">tahmini +{n(o.extraClicks)} tıklama</span>}
              />
            ))}
          </OpsList>
        )}
      </OpsCard>
      <OpsCard id="yamyamlik" icon={Swords} tone="rose" title="Yamyamlık (cannibalization)" sub="Aynı aramada birden çok sayfanız gösteriliyor; Google aralarında gidip geliyor. Birini ana sayfa yapıp diğerinden ona bağlantı verin.">
        {cannibals.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">Yamyamlık yok.</p>
        ) : (
          <OpsList label="Yamyamlık">
            {cannibals.map((c) => (
              <OpsRow
                key={c.query}
                primary={c.query}
                secondary={c.pages.map((p) => `${pathOf(p.page)} (%${Math.round(p.share * 100)}, ${pos(p.position)}. sıra)`).join(" · ")}
                right={<span className="text-xs text-text-muted">{n(c.impressions)} gösterim</span>}
              />
            ))}
          </OpsList>
        )}
      </OpsCard>
    </div>
  );
}

/* ================================ Programatik sayfalar ================================ */

export async function ProgrammaticTab({ canEdit }: { canEdit: boolean }) {
  const [settings, index] = await Promise.all([readHubSettings(), loadHubIndex().catch(() => null)]);
  const hubs = index?.hubs ?? [];
  const disabled = new Set(settings.disabledPaths);
  const decide = (count: number) => hubDecision(count, { ...settings, enabled: true });
  const indexable = hubs.filter((h) => decide(h.count) === "index");
  const thin = hubs.filter((h) => decide(h.count) === "noindex");
  const top = [...hubs].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)).slice(0, 80);
  const kpis: OpsKpi[] = [
    { key: "ilan", title: "Kaynak ilan", value: n(index?.listings.length ?? 0), href: seoHref("sayfalar", "vitrin"), icon: MapPinned, tone: "brand", caption: "Arama onaylı ofislerin yayındaki ilanları" },
    { key: "index", title: "İndekslenen sayfa", value: n(indexable.length), href: "#hub-liste", icon: Search, tone: "mint", caption: `≥ ${settings.minListings} ilan` },
    { key: "ince", title: "Eşik altı (noindex)", value: n(thin.length), href: "#hub-liste", icon: EyeOff, tone: "slate", caption: "Sitemap dışı, follow" },
    { key: "kapali", title: "Elle kapatılan", value: n(disabled.size), href: "#hub-liste", icon: Bot, tone: "slate", caption: "404 döner" },
  ];
  return (
    <div className="space-y-6">
      {!settings.enabled ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-sm text-text-muted">
          Özellik <strong className="text-ink-950">kapalı</strong>: /emlak yolları 404 döner ve sitemap’e girmez. Aşağıdaki liste, açılırsa üretilecek sayfaların önizlemesidir.
        </p>
      ) : null}
      <OpsKpis items={kpis} label="Programatik sayfa özeti" />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <OpsCard icon={MapPinned} tone="brand" title="Ayarlar" sub="Yalnız gerçek ilan; eşik altı sayfa noindex. Metin ve SSS gerçek istatistikten üretilir.">
          <div className="py-2">
            <HubSettingsForm value={settings} canEdit={canEdit} />
          </div>
        </OpsCard>
        <OpsCard id="hub-liste" icon={Layers} tone="mint" title={`Sayfalar (${n(hubs.length)})`} sub="En çok ilanı olan ilk 80 sayfa. Kapatılan sayfa 404 döner ve sitemap’e girmez.">
          {top.length === 0 ? (
            <p className="py-3 text-sm text-text-muted">Kaynak ilan yok: arama onayı veren ve vitrini açık ofislerin yayındaki ilanı bulunmuyor.</p>
          ) : (
            <OpsList label="Programatik sayfalar">
              {top.map((h) => {
                const d = decide(h.count);
                const off = disabled.has(h.path);
                return (
                  <OpsRow
                    key={h.path}
                    primary={hubTitle(h)}
                    href={settings.enabled && !off ? h.path : undefined}
                    secondary={`${h.path} · ${n(h.count)} ilan`}
                    right={
                      <>
                        <StatusBadge tone={off ? "neutral" : d === "index" ? "success" : "neutral"}>{off ? "Kapalı" : d === "index" ? "index" : "noindex"}</StatusBadge>
                        {canEdit ? <HubPathToggle path={h.path} disabled={off} /> : null}
                      </>
                    }
                  />
                );
              })}
            </OpsList>
          )}
        </OpsCard>
      </div>
    </div>
  );
}

/* ================================ Yapay zekâ arama (GEO) ================================ */

export async function GeoTab({ base }: { base: string }) {
  const [s, view, guides] = await Promise.all([readSeoSettingsFresh(), loadScoreView(), listPublishedGuidesForPage().catch(() => [])]);
  const indexable = view.pages.filter((p) => !p.snap.noindex && p.snap.status >= 200 && p.snap.status < 300);
  const geo = geoReadiness({
    global: s.global,
    robots: s.robots,
    indexablePages: indexable.length,
    faqPages: indexable.filter((p) => p.snap.ldTypes.includes("FAQPage")).length,
    ldCleanPages: indexable.filter((p) => p.snap.ldErrors === 0 && p.snap.ldParseErrors === 0).length,
    guides: guides.filter((g) => !isThinGuide(g.content)).length,
  });
  const blocked = new Set(s.robots.blockedAiBots);
  const robotsHref = seoHref("tarama", "sitemap", {}, "robots");
  const fixHref: Record<string, string> = {
    "answer-bots": robotsHref,
    llms: robotsHref,
    "org-identity": seoHref("ayarlar", "genel"),
    "org-sameas": seoHref("ayarlar", "genel"),
    "org-contact": seoHref("ayarlar", "genel"),
    faq: "/admin/site/rehber",
    "ld-clean": seoHref("tarama", "veri"),
    guides: "/admin/site/rehber",
  };
  return (
    <div className="space-y-6">
      <section className="kh-card" aria-label="Yapay zekâ arama hazırlığı">
        <div className="grid gap-6 p-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
          <Ring pct={geo.score} size={128} stroke={11} tone={geo.score >= 75 ? "success" : geo.score >= 50 ? "warn" : "danger"} ariaLabel={`Yapay zekâ arama hazırlığı ${geo.score}/100`}>
            <span className="font-display text-3xl font-extrabold tabular-nums text-ink-950">{geo.score}</span>
          </Ring>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Yapay zekâ arama hazırlığı (GEO)</p>
            <p className="text-sm text-text-muted">
              ChatGPT arama, Perplexity, Claude ve Google yapay zekâ yanıtlarında kaynak olarak görünmenin denetlenebilir koşulları: tarayıcı erişimi, makine okunur site özeti, varlık tutarlılığı, soru-cevap yapısı ve hatasız yapılandırılmış veri.
            </p>
            <p className="flex flex-wrap gap-3 pt-1 text-sm">
              <a href={`${base}/llms.txt`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">/llms.txt</a>
              <a href={`${base}/llms-full.txt`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">/llms-full.txt</a>
              <a href={`${base}/robots.txt`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">/robots.txt</a>
            </p>
          </div>
        </div>
      </section>
      <OpsCard icon={Sparkles} tone="violet" title="Kontrol listesi" sub="Her satır düzeltileceği ekrana gider">
        <OpsList label="GEO kontrolleri">
          {geo.checks.map((c) => (
            <OpsRow
              key={c.id}
              primary={c.label}
              href={fixHref[c.id]}
              secondary={c.ok ? c.detail : `${c.detail} → ${c.fix}`}
              right={<StatusBadge tone={c.ok ? "success" : c.partial ? "neutral" : "attention"}>{c.ok ? "Hazır" : c.partial ? "Kısmen" : "Eksik"}</StatusBadge>}
            />
          ))}
        </OpsList>
      </OpsCard>
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <OpsCard icon={Bot} tone="mint" title="Yanıt botları" sub="Kullanıcı sorusuna canlı yanıt üretirken siteyi okuyan botlar: açık kalmalı" right={<Link href={robotsHref} className="text-sm font-semibold text-brand-700 hover:underline">Düzenle →</Link>}>
          <OpsList label="Yanıt botları">
            {AI_ANSWER_BOTS.map((b) => (
              <OpsRow key={b} primary={b} right={<StatusBadge tone={blocked.has(b) ? "attention" : "success"}>{blocked.has(b) ? "Engelli" : "İzinli"}</StatusBadge>} />
            ))}
          </OpsList>
        </OpsCard>
        <OpsCard icon={Bot} tone="slate" title="Eğitim botları" sub="Model eğitimi için tarar; engellemek bir tercihtir, yanıt görünürlüğünü doğrudan düşürmez" right={<Link href={robotsHref} className="text-sm font-semibold text-brand-700 hover:underline">Düzenle →</Link>}>
          <OpsList label="Eğitim botları">
            {AI_TRAINING_BOTS.map((b) => (
              <OpsRow key={b} primary={b} right={<StatusBadge tone="neutral">{blocked.has(b) ? "Engelli" : "İzinli"}</StatusBadge>} />
            ))}
          </OpsList>
        </OpsCard>
      </div>
    </div>
  );
}

/* ================================ Teknik tarama > bulgu özeti ================================ */

export function FindingSummary({ findings }: { findings: readonly { code: string; severity: string }[] }) {
  const by = new Map<string, { n: number; sev: string }>();
  for (const f of findings) {
    const cur = by.get(f.code);
    by.set(f.code, { n: (cur?.n ?? 0) + 1, sev: cur?.sev === "critical" ? "critical" : f.severity });
  }
  const rows = [...by].sort((a, b) => (a[1].sev === "critical" ? -1 : 0) - (b[1].sev === "critical" ? -1 : 0) || b[1].n - a[1].n);
  if (rows.length === 0) return <p className="text-sm text-text-muted">Son koşuda bulgu yok.</p>;
  return (
    <OpsList label="Bulgu türleri">
      {rows.map(([code, v]) => (
        <OpsRow
          key={code}
          primary={code}
          href={`/admin/site?alan=seo`}
          secondary={v.sev === "critical" ? "Kritik" : v.sev === "warning" ? "Uyarı" : "Bilgi"}
          right={<span className="text-sm font-bold tabular-nums text-ink-950">{n(v.n)}</span>}
        />
      ))}
    </OpsList>
  );
}
