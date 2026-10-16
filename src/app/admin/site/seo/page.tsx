import Link from "@/components/ui/smart-link";
import type { Metadata } from "next";
import { Archive, BarChart3, Bot, Braces, Globe, History, ListChecks, Map as MapIcon, SearchCheck, Shuffle, Store, WandSparkles } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildHomeFaqs, faqForJsonLd } from "@/components/marketing/faq";
import { getEffectiveTrialDays, getPublicPlanDefinitions } from "@/lib/billing/plan-definitions";
import { getLiveSiteContent } from "@/lib/site-content/store";
import { visibleSections } from "@/lib/site-content/schema";
import { getBaseUrl } from "@/lib/base-url";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { formatDateTimeTr } from "@/lib/format";
import { requirePlatformModule } from "@/lib/platform";
import { buildPageJsonLd, validateJsonLd } from "@/lib/seo/jsonld";
import { effectivePageView } from "@/lib/seo/metadata";
import { analyzeRedirects, normalizeRedirectPath } from "@/lib/seo/redirects";
import { getSeoPage, seoPages } from "@/lib/seo/registry";
import { pageChecklist } from "@/lib/seo/rules";
import { readSeoSettingsFresh, readAuditLatest, readIndexNow, readIndexNowLog, readSeoAi, listNotFound } from "@/lib/seo/store";
import { changedPagePaths, seoPublishSurface } from "@/lib/seo/publish-surface";
import { canAutoOptimize } from "@/lib/seo/scope";
import { readPlatformAiQuota } from "@/lib/ai/platform-quota";
import { now, trDayKey } from "@/lib/clock";
import { loadSitemapFresh } from "@/lib/seo/sitemap-data";
import { SEO_HISTORY_LABELS, diffSeoValues, listSeoHistory } from "@/lib/seo/history";
import { notFoundCandidates, suggest404Target } from "@/lib/seo/not-found-suggest";
import { SEO_KEYS, type SeoPages } from "@/lib/seo/schema";
import { getPlatformSettingsMany } from "@/lib/platform-settings";
import { buildFaq } from "@/lib/pricing-page-model";
import { loadPatternData } from "./pattern-samples";
import { loadVitrinOffices } from "./vitrin-offices";
import { NeverIndexForm } from "./seo-vitrin-panel";
import { DEFAULT_NEVER_INDEX_SLUGS } from "@/lib/vitrin-seo/never-index";
import { SeoTabs } from "./seo-tabs";
import { AiSuggestPanel, SeoAiSettingsPanel, SeoDraftPanel } from "./seo-growth-panels";
import { PatternsPanel } from "./seo-patterns-panel";
import { HistoryRestoreButton } from "./seo-history-panel";
import { PageEditor, type PageEditorData } from "./seo-page-editor";
import { RedirectsPanel, type RuleIssues } from "./seo-redirects-panel";
import {
  BackupPanel,
  GlobalForm,
  IndexNowPanel,
  JsonLdValidator,
  RobotRunPanel,
  RobotsForm,
  SitemapForm,
  type SitemapPreview,
} from "./seo-settings-forms";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { gscSummary, readInspections } from "@/lib/google/db";
import { parsePeriod } from "@/lib/google/performance-model";
import { readConnectionView } from "@/lib/google/read";
import { serviceCard } from "@/lib/google/view-model";
import { PerformanceView, TABS as PERF_TABS, type PerformanceData } from "./performance-view";


// "Robotu şimdi çalıştır" sunucu action'ı bu segmentin süre sınırını kullanır.
export const maxDuration = 60;

// Temel: Genel ve kurulum · Arama performansı · Denetim robotu. Uzman ▾: diğerleri. `?sekme=` adresleri değişmez.
const TABS = [
  { id: "genel", label: "Genel ve kurulum", icon: Globe },
  { id: "performans", label: "Arama performansı", icon: BarChart3 },
  { id: "robot", label: "Denetim robotu", icon: Bot },
  { id: "sayfalar", label: "Sayfa başlıkları ve açıklamaları", icon: ListChecks, expert: true },
  { id: "kaliplar", label: "Dinamik kalıplar", icon: WandSparkles, expert: true },
  { id: "vitrin", label: "Vitrin", icon: Store, expert: true },
  { id: "sitemap", label: "Sitemap ve robots", icon: MapIcon, expert: true },
  { id: "yonlendirme", label: "Yönlendirmeler ve 404", icon: Shuffle, expert: true },
  { id: "veri", label: "Yapılandırılmış veri", icon: Braces, expert: true },
  { id: "gecmis", label: "Geçmiş", icon: History, expert: true },
  { id: "yedek", label: "Yedek", icon: Archive, expert: true },
] as const;
type TabId = (typeof TABS)[number]["id"];

type SP = { sekme?: string; sayfa?: string; kaynak?: string; hedef?: string; alt?: string; donem?: string };

const activeTab = (sekme: string | undefined): TabId => (TABS.find((t) => t.id === sekme)?.id ?? "genel") as TabId;

export async function generateMetadata({ searchParams }: { searchParams?: Promise<SP> }): Promise<Metadata> {
  const tab = activeTab(((await searchParams) ?? {}).sekme);
  return { title: tab === "genel" ? "SEO merkezi" : `SEO: ${TABS.find((t) => t.id === tab)!.label}` };
}

export default async function AdminSeoPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const staff = await requirePlatformModule("seo");
  const sp = (await searchParams) ?? {};
  const active = activeTab(sp.sekme);
  const canSensitive = staff.role === "super_admin";
  const base = getBaseUrl();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Arama motoru görünürlüğü"
        icon={SearchCheck}
        title="SEO merkezi"
        description="Başlık, açıklama, paylaşım kartı, sitemap, robots.txt, yapılandırılmış veri, yönlendirme ve günlük denetim robotu tek yerden. Ayar yokken site bugünkü değerleriyle çalışır."
        glow="brand"
      />
      <SeoTabs base="/admin/site/seo" tabs={TABS} active={active} />
      <SeoDraftSection canPublish={canSensitive} />
      {active === "genel" ? <GeneralTab canEdit={canSensitive} base={base} /> : null}
      {active === "sayfalar" ? <PagesTab selected={sp.sayfa} canSensitive={canSensitive} base={base} /> : null}
      {active === "kaliplar" ? <PatternsTab canEdit={canSensitive} base={base} /> : null}
      {active === "vitrin" ? <VitrinTab canEdit={canSensitive} /> : null}
      {active === "sitemap" ? <SitemapTab canEdit={canSensitive} base={base} /> : null}
      {active === "veri" ? <StructuredDataTab base={base} /> : null}
      {active === "yonlendirme" ? <RedirectsTab canBulk={canSensitive} prefill={sp.kaynak} prefillTo={sp.hedef} /> : null}
      {active === "robot" ? <RobotTab canRun={canSensitive} /> : null}
      {active === "performans" ? <PerformanceTab tab={sp.alt} donem={sp.donem} /> : null}
      {active === "gecmis" ? <HistoryTab canRestore={canSensitive} /> : null}
      {active === "yedek" ? <BackupPanel canImport={canSensitive} /> : null}
    </div>
  );
}

/* ------------------------------ Genel ------------------------------ */

async function GeneralTab({ canEdit, base }: { canEdit: boolean; base: string }) {
  const [s, indexNow, log, ai, quota] = await Promise.all([readSeoSettingsFresh(), readIndexNow(), readIndexNowLog(), readSeoAi(), readPlatformAiQuota("seo.ai")]);
  const v = s.global.verification;
  const checks = [
    { id: "vGoogle", label: "Google Search Console", ok: Boolean(v.google) },
    { id: "vBing", label: "Bing Webmaster", ok: Boolean(v.bing) },
    { id: "vYandex", label: "Yandex Webmaster", ok: Boolean(v.yandex) },
  ];
  const month = trDayKey(now()).slice(0, 7);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Kurulum kontrol listesi</CardTitle>
            <CardDescription>Arama motoru doğrulama kodları aşağıdaki Genel formundan girilir. Boş olan sarı görünür.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 md:grid-cols-3">
            {checks.map((c) => (
              <li key={c.id}>
                <a href={`#${c.id}`} className={`flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold ${c.ok ? "tone-success" : "tone-warning"}`}>
                  <span>{c.label}</span>
                  <span className="text-xs">{c.ok ? "Doğrulama kodu var" : "Eksik"}</span>
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <IndexNowPanel value={indexNow} canEdit={canEdit} base={base} log={log} />
      <SeoAiSettingsPanel value={ai} canEdit={canEdit} usedThisMonth={quota === null ? null : quota.period === month ? quota.used : 0} />
      <GlobalForm value={s.global} canEdit={canEdit} />
    </div>
  );
}

/* ------------------------------ SEO taslağı ------------------------------ */

/** Yayınlanmamış SEO taslağı varsa her sekmenin üstünde görünür (taslak canlıyı değiştirmez). */
async function SeoDraftSection({ canPublish }: { canPublish: boolean }) {
  const state = await seoPublishSurface.readState();
  if (!state.draft) return null;
  const live = (state.live ?? {}) as SeoPages;
  const draft = state.draft as SeoPages;
  const changes = changedPagePaths(live, draft).map((path) => ({
    path,
    fields: Object.keys({ ...(live[path] ?? {}), ...(draft[path] ?? {}) }).filter(
      (k) => k !== "updatedAt" && JSON.stringify((live[path] as Record<string, unknown> | undefined)?.[k]) !== JSON.stringify((draft[path] as Record<string, unknown> | undefined)?.[k]),
    ),
  }));
  return <SeoDraftPanel changes={changes} canPublish={canPublish} />;
}

/* ------------------------------ Sayfalar ------------------------------ */

async function PagesTab({ selected, canSensitive, base }: { selected?: string; canSensitive: boolean; base: string }) {
  const [s, audit, planDefs] = await Promise.all([readSeoSettingsFresh(), readAuditLatest(), getPublicPlanDefinitions()]);
  const plans = planDefs.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry }));
  const rows = seoPages().map((def) => {
    const ov = s.pages[def.path];
    const view = effectivePageView(def, ov, s.global);
    const kinds = (ov?.jsonLd ?? def.jsonLd).filter((k) => k !== "FAQPage");
    const graph = buildPageJsonLd({
      global: s.global,
      base,
      path: def.path,
      plans,
      kinds,
      tool: def.group === "arac" && def.path !== "/araclar" ? { title: def.title ?? def.label, description: def.description ?? "", url: `${base}${def.path}` } : undefined,
    });
    const abs = def.path === "/" ? base : `${base}${def.path}`;
    const h1 = audit ? (audit.h1[abs] ?? audit.h1[`${abs}/`] ?? null) : null;
    const checklist = pageChecklist({
      renderedTitle: view.renderedTitle,
      description: view.description,
      canonical: view.canonical,
      base,
      ogImage: view.ogImage,
      indexable: view.indexable,
      inSitemap: view.inSitemap,
      jsonLdErrors: graph ? validateJsonLd(graph) : null,
      h1Count: h1,
    });
    return { def, ov, view, checklist };
  });

  const selectedRow = rows.find((r) => r.def.path === selected);
  const editor: PageEditorData | null = selectedRow
    ? {
        path: selectedRow.def.path,
        label: selectedRow.def.label,
        canIndex: selectedRow.def.canIndex,
        defaults: {
          title: selectedRow.def.title,
          description: selectedRow.def.description,
          ogTitle: selectedRow.def.ogTitle ?? null,
          ogDescription: selectedRow.def.ogDescription ?? null,
          index: selectedRow.def.index,
          sitemapInclude: selectedRow.def.sitemap.include,
          priority: selectedRow.def.sitemap.priority,
          freq: selectedRow.def.sitemap.freq,
          jsonLd: selectedRow.def.jsonLd,
        },
        override: selectedRow.ov ?? null,
        checklist: selectedRow.checklist,
      }
    : null;

  return (
    <div className="space-y-6">
      {editor ? (
        <PageEditor
          key={`${editor.path}:${editor.override?.updatedAt ?? "0"}`}
          data={editor}
          titleTemplate={s.global.titleTemplate}
          defaultTitle={s.global.defaultTitle}
          defaultDescription={s.global.defaultDescription}
          defaultOgImage={s.global.ogImage}
          base={base}
          canSensitive={canSensitive}
        />
      ) : null}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Public sayfa envanteri ({rows.length})</CardTitle>
            <CardDescription>
              Token’lı portallar, /app, /admin, imza, ödeme, anket ve randevu sayfaları burada yönetilmez: her zaman noindex’tir ve sitemap’e girmez. Satıra tıklayarak düzenleyin.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table className="w-full min-w-[36rem] text-left text-sm">
            <THead>
              <TR className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
                <TH scope="col" className="px-4 py-2 font-semibold">Sayfa</TH>
                <TH scope="col" className="px-4 py-2 font-semibold">Başlık</TH>
                <TH scope="col" className="px-4 py-2 font-semibold">Kontrol</TH>
                <TH scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">İşlem</span></TH>
              </TR>
            </THead>
            <TBody className="divide-y divide-line">
              {rows.map(({ def, view, checklist, ov }) => {
                const failing = checklist.filter((c) => c.verdict !== "ok").length;
                return (
                  <TR key={def.path} className={selected === def.path ? "bg-canvas" : undefined}>
                    <TD className="px-4 py-2.5">
                      <p className="font-semibold text-ink-950">{def.label}</p>
                      <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-text-muted">
                        {def.path}
                        {/* İndeks/sitemap: sütun değil rozet; yalnız varsayılandan sapınca (noindex / sitemap dışı). */}
                        {!view.indexable ? <StatusBadge tone="neutral">noindex</StatusBadge> : null}
                        {!view.inSitemap ? <StatusBadge tone="neutral">sitemap dışı</StatusBadge> : null}
                      </p>
                    </TD>
                    <TD className="max-w-xs px-4 py-2.5">
                      <p className="truncate text-ink-950">{view.renderedTitle}</p>
                      <p className="text-xs text-text-muted">{view.renderedTitle.length} karakter{ov ? " · özelleştirilmiş" : ""}</p>
                    </TD>
                    <TD className="px-4 py-2.5">
                      <StatusBadge tone={failing === 0 ? "success" : "attention"}>{failing === 0 ? "Tümü geçti" : `${failing} madde dikkat`}</StatusBadge>
                    </TD>
                    <TD className="px-4 py-2.5 text-right">
                      <Link
                        href={`/admin/site/seo?sekme=sayfalar&sayfa=${encodeURIComponent(def.path)}#editor`}
                        className="focus-ring inline-flex min-h-9 items-center rounded px-2 text-sm font-semibold text-brand-700 hover:underline touch:min-h-11"
                      >
                        Düzenle
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ Sitemap ve robots ------------------------------ */

async function SitemapTab({ canEdit, base }: { canEdit: boolean; base: string }) {
  const [s, fresh] = await Promise.all([readSeoSettingsFresh(), loadSitemapFresh()]);
  const flat = fresh.chunks.flat();
  const count = (test: (path: string) => boolean) =>
    flat.filter((e) => {
      try {
        return test(new URL(e.url).pathname);
      } catch {
        return false;
      }
    }).length;
  const preview: SitemapPreview = {
    total: fresh.total,
    chunks: fresh.chunks.length,
    sample: flat.slice(0, 40).map((e) => e.url),
    counts: [
      { label: "Statik sayfalar", n: count((p) => Boolean(getSeoPage(p)) && !p.startsWith("/araclar")) },
      { label: "Araçlar", n: count((p) => p.startsWith("/araclar")) },
      { label: "Vitrin ofisleri", n: count((p) => /^\/vitrin\/[^/]+$/.test(p)) },
      { label: "Vitrin ilanları", n: count((p) => /^\/vitrin\/[^/]+\/[^/]+$/.test(p)) },
      { label: "Danışmanlar", n: count((p) => p.startsWith("/danisman/")) },
    ],
  };
  return (
    <div className="space-y-6">
      <SitemapForm value={s.sitemap} canEdit={canEdit} preview={preview} />
      <RobotsForm value={s.robots} canEdit={canEdit} base={base} />
    </div>
  );
}

/* ------------------------------ Yapılandırılmış veri ------------------------------ */

async function StructuredDataTab({ base }: { base: string }) {
  // Canlı ana sayfayla aynı kaynak: admin paket tanımları + yayındaki site içeriğinin SSS'si (gizli bölümde FAQPage yok).
  const [s, planDefs, trialDays, content] = await Promise.all([readSeoSettingsFresh(), getPublicPlanDefinitions(), getEffectiveTrialDays(), getLiveSiteContent()]);
  const plans = planDefs.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry }));
  const homeFaq = visibleSections(content).includes("sss") ? faqForJsonLd(buildHomeFaqs({ trialDays, plans: planDefs, content: content.faq })) : [];
  const samples = [
    { path: "/", faq: homeFaq },
    { path: "/fiyatlar", faq: buildFaq() },
  ].map(({ path, faq }) => {
    const def = getSeoPage(path);
    const kinds = s.pages[path]?.jsonLd ?? def?.jsonLd ?? [];
    const graph = buildPageJsonLd({ global: s.global, base, path, plans, faq, kinds });
    return { path, graph, errors: graph ? validateJsonLd(graph) : [] };
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Hangi veri nerede basılıyor</CardTitle>
            <CardDescription>Türler Sayfalar sekmesinde sayfa bazında açılıp kapatılır; üretilen çıktı aşağıda doğrulanır.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-text-muted">
            <li><strong className="text-ink-950">Organization</strong> ve <strong className="text-ink-950">WebSite</strong>: ana sayfa. Ad, logo, sosyal profiller ve iletişim Genel sekmesinden; boş alan basılmaz. SearchAction yok (çalışan site içi arama olmadığı için).</li>
            <li><strong className="text-ink-950">SoftwareApplication + Offer</strong>: ana sayfa ve /fiyatlar; paket başına gerçek, KDV hariç aylık fiyat (paket kaynağı: yönetimdeki paket tanımları).</li>
            <li><strong className="text-ink-950">FAQPage</strong>: yalnız sayfada görünen SSS ile birebir.</li>
            <li><strong className="text-ink-950">BreadcrumbList</strong>: iç sayfalar.</li>
            <li><strong className="text-ink-950">WebApplication</strong>: ücretsiz araçlar. <strong className="text-ink-950">RealEstateListing/Offer</strong>: vitrin ilan sayfası (kodda).</li>
            <li className="font-semibold text-ink-950">AggregateRating ve Review hiçbir koşulda üretilmez; doğrulayıcı bunları hata sayar.</li>
          </ul>
        </CardContent>
      </Card>
      {samples.map((smp) => (
        <Card key={smp.path}>
          <CardHeader>
            <div>
              <CardTitle>{smp.path === "/" ? "Ana sayfa" : smp.path} çıktısı</CardTitle>
              <CardDescription>{smp.errors.length === 0 ? "Zorunlu alan kontrolü: geçti." : `${smp.errors.length} sorun bulundu.`}</CardDescription>
            </div>
            <StatusBadge tone={smp.errors.length === 0 ? "success" : "attention"}>{smp.errors.length === 0 ? "Geçerli" : "Hatalı"}</StatusBadge>
          </CardHeader>
          <CardContent className="space-y-2">
            {smp.errors.length > 0 ? (
              <ul className="list-disc pl-5 text-sm text-danger-600">
                {smp.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            <pre className="max-h-72 overflow-auto rounded-[var(--radius-control)] bg-canvas p-3 font-mono text-xs text-text-muted">
              {smp.graph ? JSON.stringify(smp.graph, null, 2) : "Bu sayfa için yapılandırılmış veri kapalı."}
            </pre>
          </CardContent>
        </Card>
      ))}
      <JsonLdValidator />
    </div>
  );
}

/* ------------------------------ Yönlendirmeler ve 404 ------------------------------ */

async function RedirectsTab({ canBulk, prefill, prefillTo }: { canBulk: boolean; prefill?: string; prefillTo?: string }) {
  const [s, nf] = await Promise.all([readSeoSettingsFresh(), listNotFound(100)]);
  const issues: RuleIssues = {};
  for (const i of analyzeRedirects(s.redirects)) (issues[i.ruleId] ??= []).push(i.message);
  const sitePath = (v?: string) => (v && v.startsWith("/") && !v.startsWith("//") ? v.slice(0, 300) : undefined);
  const prefillFrom = sitePath(prefill);
  const prefillTarget = sitePath(prefillTo);
  // Öneri adayları: yönetilebilir sayfalar + mevcut yönlendirme hedefleri (yalnız var olan hedefler önerilir).
  const candidates = notFoundCandidates(s.redirects);
  const redirected = new Set(s.redirects.filter((r) => r.enabled).map((r) => normalizeRedirectPath(r.from)));
  return (
    <div className="space-y-6">
      <RedirectsPanel key={`${prefillFrom ?? ""}|${prefillTarget ?? ""}`} rules={s.redirects} issues={issues} canBulk={canBulk} prefillFrom={prefillFrom} prefillTo={prefillTarget} />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>En çok 404 alan yollar</CardTitle>
            <CardDescription>Yalnız yol ve sayaç saklanır (IP ya da sorgu dizesi yok). Bir satırdan yönlendirme başlatabilirsiniz.</CardDescription>
          </div>
        </CardHeader>
        {!nf.available ? (
          <CardContent>
            <p className="text-sm text-text-muted">404 kaydı henüz etkin değil: veritabanı migration’ı (20260816001790_seo_404_hits) uygulanınca burada listelenir. Yönlendirmeler bundan bağımsız çalışır.</p>
          </CardContent>
        ) : nf.rows.length === 0 ? (
          <CardContent>
            <p className="text-sm text-text-muted">Henüz kayıtlı 404 yok.</p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[42rem] text-left text-sm">
              <THead>
                <TR className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
                  <TH scope="col" className="px-4 py-2 font-semibold">Yol</TH>
                  <TH scope="col" className="px-4 py-2 font-semibold">İstek</TH>
                  <TH scope="col" className="px-4 py-2 font-semibold">Son görülme</TH>
                  <TH scope="col" className="px-4 py-2 font-semibold">Gönderen</TH>
                  <TH scope="col" className="px-4 py-2 font-semibold">Öneri</TH>
                  <TH scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">İşlem</span></TH>
                </TR>
              </THead>
              <TBody className="divide-y divide-line">
                {nf.rows.map((r) => {
                  const suggestion = suggest404Target(r.path, candidates);
                  const done = redirected.has(normalizeRedirectPath(r.path));
                  const href = `/admin/site/seo?sekme=yonlendirme&kaynak=${encodeURIComponent(r.path)}${suggestion ? `&hedef=${encodeURIComponent(suggestion)}` : ""}#rd-from`;
                  return (
                    <TR key={r.path}>
                      <TD className="max-w-xs truncate px-4 py-2.5 font-mono text-xs text-ink-950">{r.path}</TD>
                      <TD className="px-4 py-2.5 tabular-nums">{r.hits}</TD>
                      <TD className="px-4 py-2.5 text-text-muted">{formatDateTimeTr(r.last_seen_at)}</TD>
                      <TD className="px-4 py-2.5 text-text-muted">{r.referrer_host ?? "-"}</TD>
                      <TD className="px-4 py-2.5 text-xs">
                        {done ? (
                          <StatusBadge tone="success">Yönlendirildi</StatusBadge>
                        ) : suggestion ? (
                          <span className="text-ink-950">
                            Öneri: <code className="rounded bg-canvas px-1 py-0.5">{suggestion}</code>
                          </span>
                        ) : (
                          <span className="text-text-faint">-</span>
                        )}
                      </TD>
                      <TD className="px-4 py-2.5 text-right">
                        {done ? null : (
                          <Link href={href} className="focus-ring inline-flex min-h-9 items-center rounded px-2 text-sm font-semibold text-brand-700 hover:underline touch:min-h-11">
                            Yönlendir
                          </Link>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Dinamik kalıplar ------------------------------ */

async function PatternsTab({ canEdit, base }: { canEdit: boolean; base: string }) {
  const [s, data] = await Promise.all([readSeoSettingsFresh(), loadPatternData()]);
  return (
    <div className="space-y-6">
      <PatternsPanel value={s.patterns} samples={{ office: data.office, listing: data.listing, agent: data.agent }} base={base} canEdit={canEdit} />
    </div>
  );
}

/* ------------------------------ Vitrin ------------------------------ */

async function VitrinTab({ canEdit }: { canEdit: boolean }) {
  const [s, data] = await Promise.all([readSeoSettingsFresh(), loadVitrinOffices()]);
  const indexed = data.rows.filter((r) => r.optin && r.vitrinEnabled && !r.neverIndex).length;
  const extra = data.neverIndexList.filter((x) => !DEFAULT_NEVER_INDEX_SLUGS.includes(x)).sort();
  return (
    <div className="space-y-6">
      <NeverIndexForm defaults={DEFAULT_NEVER_INDEX_SLUGS} extra={extra} canEdit={canEdit} />
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Ofis vitrinleri: arama motoru durumu</CardTitle>
            <CardDescription>
              Vitrin, ilan ve danışman sayfalarının indekslenmesi ofisin kendi onayına bağlıdır (Ayarlar, Vitrin: “vitrinim aramalarda görünsün”); onay kararı ofisindir ve burada değiştirilmez. Onaysız ya da kalıcı noindex listesindeki ofislerin sayfaları “noindex, follow” döner. İlan sayısı: yayındaki, kapanmamış, örnek olmayan ilanlar.
            </CardDescription>
          </div>
          <StatusBadge tone={indexed > 0 ? "success" : "neutral"}>{indexed} indekslenir</StatusBadge>
        </CardHeader>
        {data.rows.length === 0 ? (
          <CardContent>
            <p className="text-sm text-text-muted">Aktif ofis bulunamadı.</p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[40rem] text-left text-sm">
              <THead>
                <TR className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
                  <TH scope="col" className="px-4 py-2 font-semibold">Ofis</TH>
                  <TH scope="col" className="px-4 py-2 font-semibold">Durum</TH>
                  <TH scope="col" className="px-4 py-2 text-right font-semibold">Yayındaki ilan</TH>
                  <TH scope="col" className="px-4 py-2 font-semibold">Neden</TH>
                </TR>
              </THead>
              <TBody className="divide-y divide-line">
                {data.rows.map((r) => {
                  const ok = r.optin && r.vitrinEnabled && !r.neverIndex;
                  const reason = !r.vitrinEnabled
                    ? "Ofis vitrinini kapatmış (sayfalar 404)."
                    : r.neverIndex
                      ? "Kalıcı noindex (liste ya da örnek veri); onaydan bağımsız."
                      : r.optin
                        ? s.sitemap.vitrinOffices
                          ? "Ofis arama onayı verdi; sitemap’e girer."
                          : "Ofis arama onayı verdi; ancak sitemap’te vitrin ofisleri kapalı."
                        : "Ofis arama onayı vermedi.";
                  return (
                    <TR key={r.id}>
                      <TD className="px-4 py-2.5">
                        <Link href={`/admin/tenants/${r.id}`} className="font-semibold text-ink-950 hover:underline">
                          {r.name}
                        </Link>
                        <p className="font-mono text-xs text-text-muted">/vitrin/{r.slug}</p>
                      </TD>
                      <TD className="px-4 py-2.5">
                        <StatusBadge tone={ok ? "success" : "neutral"}>{ok ? "index, follow" : "noindex, follow"}</StatusBadge>
                      </TD>
                      <TD className="px-4 py-2.5 text-right tabular-nums">
                        {r.vitrinEnabled ? (
                          <a href={`/vitrin/${r.slug}`} target="_blank" rel="noreferrer" className="font-semibold text-ink-950 hover:underline">
                            {r.liveListings.toLocaleString("tr-TR")}
                          </a>
                        ) : (
                          r.liveListings.toLocaleString("tr-TR")
                        )}
                      </TD>
                      <TD className="px-4 py-2.5 text-text-muted">{reason}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {data.total > data.rows.length ? (
              <p className="px-4 py-2 text-xs text-text-muted">İlk {data.rows.length} ofis gösteriliyor (toplam {data.total}); onay verenler önce listelenir.</p>
            ) : null}
            {data.countsPartial ? <p className="px-4 py-2 text-xs text-text-muted">İlan sayıları eksik olabilir (sayım üst sınırına ulaşıldı ya da okunamadı).</p> : null}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Geçmiş ------------------------------ */

const clip = (v: string | null) => (v == null ? "(yok)" : v.length > 120 ? `${v.slice(0, 119)}…` : v);

async function HistoryTab({ canRestore }: { canRestore: boolean }) {
  const [entries, current] = await Promise.all([
    listSeoHistory(),
    getPlatformSettingsMany([SEO_KEYS.global, SEO_KEYS.pages, SEO_KEYS.sitemap, SEO_KEYS.robots, SEO_KEYS.redirects, SEO_KEYS.patterns]),
  ]);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>SEO ayar geçmişi ({entries.length})</CardTitle>
          <CardDescription>
            Her kayıttan önce o ayarın önceki değeri saklanır (en çok 30 kayıt). Fark, o zamanki değer ile ŞU ANKİ değer arasındadır. Robot denetimi ve IndexNow durumları geçmişe girmez.
          </CardDescription>
        </div>
      </CardHeader>
      {entries.length === 0 ? (
        <CardContent>
          <p className="text-sm text-text-muted">Henüz kayıt yok. Bir SEO ayarını kaydettiğinizde önceki değer burada görünür ve tek tıkla geri yüklenebilir.</p>
        </CardContent>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((e) => {
            const label = SEO_HISTORY_LABELS[e.key] ?? e.key;
            const { diffs, total } = diffSeoValues(e.prev, current[SEO_KEYS[e.key]] ?? null, 12);
            const when = formatDateTimeTr(e.at);
            return (
              <li key={e.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge tone="neutral">{label}</StatusBadge>
                  <span className="text-sm font-semibold text-ink-950">{when}</span>
                  <span className="text-xs text-text-muted">{e.byName || (e.by ? "Platform personeli" : "Sistem")}</span>
                  {e.prev === null ? <span className="text-xs text-text-muted">· öncesinde ayar yoktu (varsayılan)</span> : null}
                </div>
                {total === 0 ? (
                  <p className="text-xs text-text-muted">Bu kayıttaki değer şu anki değerle aynı.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="adm-tbl-m w-full text-left text-xs md:min-w-[32rem]">
                      <thead>
                        <tr className="text-text-muted">
                          <th scope="col" className="py-1 pr-3 font-semibold">Alan</th>
                          <th scope="col" className="py-1 pr-3 font-semibold">O zamanki değer</th>
                          <th scope="col" className="py-1 font-semibold">Şu anki değer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diffs.map((d) => (
                          <tr key={d.path} className="align-top">
                            <td className="py-1 pr-3 font-mono text-ink-950">{d.path}</td>
                            <td data-label="O zamanki" className="break-all py-1 pr-3 text-danger-600">{clip(d.before)}</td>
                            <td data-label="Şu anki" className="break-all py-1 text-success-strong">{clip(d.after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {total > diffs.length ? <p className="mt-1 text-xs text-text-muted">+{total - diffs.length} alan daha</p> : null}
                  </div>
                )}
                {canRestore && total > 0 ? <HistoryRestoreButton id={e.id} label={label} at={when} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {!canRestore ? (
        <CardContent className="border-t border-line">
          <p className="text-xs text-text-muted">Geri yükleme yalnız süper admin içindir.</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

/* ------------------------------ Robot ------------------------------ */

async function RobotTab({ canRun }: { canRun: boolean }) {
  const [run, ai] = await Promise.all([readAuditLatest(), readSeoAi()]);
  const aiPages = canRun && ai.enabled ? seoPages().filter((p) => p.index && canAutoOptimize(p.path)).map((p) => ({ path: p.path, label: p.label })) : [];
  const cron = CRON_JOBS.find((j) => j.job === "seo-robot");
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>SEO robotu</CardTitle>
            <CardDescription>
              Her gün {cron?.cadenceLabel.replace("her gün ", "") ?? "04:20"} ana sayfa ve sitemap’inizdeki sayfaları KENDİ sunucunuzdan kontrol eder ve iç bağlantılarla 2 seviyeye kadar sitemap dışı sayfaları da keşfeder (harici site taraması yok): durum kodu, başlık, açıklama, canonical, OG, h1, başlık sırası, görsel alt metni, içerik uzunluğu, yanıt süresi, robots, yapılandırılmış veri, yinelenenler, noindex/sitemap çelişkisi, sitemap dışı aranabilir sayfa, yetim sayfa, kırık iç bağlantı örneklemesi ve robots-sitemap tutarlılığı. Kritik bulguda platform bildirimi gönderir.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <RobotRunPanel canRun={canRun} />
          {run ? (
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Kritik", run.summary.critical],
                ["Uyarı", run.summary.warning],
                ["Bilgi", run.summary.info],
                ["Denetlenen sayfa", run.summary.pagesChecked],
              ].map(([label, n]) => (
                <div key={String(label)} className="rounded-[var(--radius-card)] border border-line p-3">
                  <p className="text-xs text-text-muted">{label}</p>
                  <p className="text-2xl font-bold tabular-nums text-ink-950">{n}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Robot henüz çalışmadı. Günlük çalışmayı bekleyin ya da (süper admin) şimdi çalıştırın.</p>
          )}
          {run ? (
            <p className="text-xs text-text-muted">
              Son çalışma: {formatDateTimeTr(run.at)} · {run.trigger === "cron" ? "otomatik" : "elle"} · {Math.round(run.durationMs / 1000)} sn · {run.summary.linksChecked} iç bağlantı örneklendi
              {run.discovered ? ` · ${run.discovered} sayfa keşifle bulundu` : ""}
              {run.truncated ? " · bütçe sınırı nedeniyle kısmi" : ""}
            </p>
          ) : null}
          {run?.notes.length ? (
            <ul className="list-disc pl-5 text-xs text-text-muted">
              {run.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* Bulgu listesi burada çizilmez: robot bulguları Site > Genel bakış'taki öneri kuyruğuna (Kokpit) düşer (tek liste). */}
      <p className="text-sm text-text-muted">
        Bulgular ve düzeltme önerileri:{" "}
        <Link href="/admin/site?alan=seo" className="font-semibold text-brand-700 hover:underline">
          Kokpit öneri kuyruğu (SEO) →
        </Link>
      </p>

      <AiSuggestPanel pages={aiPages} />
    </div>
  );
}

/* ------------------------------ Arama performansı ------------------------------ */

/**
 * Search Console performansı (eski ayrı sayfa; artık SEO sekmesi). Render sırasında Google API çağrılmaz: yalnız
 * `seo_gsc_daily` / `seo_url_inspections` okunur. Bağlı değilse tablolar hiç sorgulanmaz, kurulum kartı çizilir.
 */
async function PerformanceTab({ tab: tabRaw, donem }: { tab?: string; donem?: string }) {
  const tab = (PERF_TABS.find((t) => t.id === tabRaw)?.id ?? "sorgular") as PerformanceData["tab"];
  const period = parsePeriod(donem);
  const view = await readConnectionView();
  const card = serviceCard(view, "gsc");
  const connected = card.status !== "bagli_degil";
  const [queries, pages, inspections] = connected
    ? await Promise.all([
        tab === "sorgular" ? gscSummary(period, "query", 200) : Promise.resolve(null),
        tab === "sayfalar" ? gscSummary(period, "page", 200) : Promise.resolve(null),
        tab === "inceleme" ? readInspections(500) : Promise.resolve(null),
      ])
    : [null, null, null];
  return <PerformanceView data={{ card, property: view.gscProperty, period, tab, queries, pages, inspections }} />;
}
