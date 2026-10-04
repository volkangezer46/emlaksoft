import Link from "next/link";
import { Archive, Bot, Braces, Globe, ListChecks, Map as MapIcon, SearchCheck, Shuffle } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PageTabs } from "@/components/app/page-tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { FAQS } from "@/components/marketing/faq";
import { PLANS } from "@/lib/billing/plans";
import { getBaseUrl } from "@/lib/base-url";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { formatDateTimeTr } from "@/lib/format";
import { requirePlatformModule } from "@/lib/platform";
import { buildPageJsonLd, validateJsonLd } from "@/lib/seo/jsonld";
import { effectivePageView } from "@/lib/seo/metadata";
import { analyzeRedirects } from "@/lib/seo/redirects";
import { getSeoPage, seoPages } from "@/lib/seo/registry";
import { pageChecklist } from "@/lib/seo/rules";
import { readSeoSettingsFresh, readAuditHistory, readAuditLatest, readIndexNow, listNotFound } from "@/lib/seo/store";
import { loadSitemapFresh } from "@/lib/seo/sitemap-data";
import { buildFaq } from "@/lib/pricing-page-model";
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

export const metadata = { title: "SEO merkezi" };
// "Robotu şimdi çalıştır" sunucu action'ı bu segmentin süre sınırını kullanır.
export const maxDuration = 60;

const TABS = [
  { id: "genel", label: "Genel", icon: Globe },
  { id: "sayfalar", label: "Sayfalar", icon: ListChecks },
  { id: "sitemap", label: "Sitemap ve robots", icon: MapIcon },
  { id: "veri", label: "Yapılandırılmış veri", icon: Braces },
  { id: "yonlendirme", label: "Yönlendirmeler ve 404", icon: Shuffle },
  { id: "robot", label: "Robot", icon: Bot },
  { id: "yedek", label: "Yedek", icon: Archive },
] as const;
type TabId = (typeof TABS)[number]["id"];

type SP = { sekme?: string; sayfa?: string; kaynak?: string };

const SEVERITY_LABEL = { critical: "Kritik", warning: "Uyarı", info: "Bilgi" } as const;

export default async function AdminSeoPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const staff = await requirePlatformModule("seo");
  const sp = (await searchParams) ?? {};
  const active: TabId = (TABS.find((t) => t.id === sp.sekme)?.id ?? "genel") as TabId;
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
      <PageTabs base="/admin/seo" label="SEO sekmeleri" tabs={TABS} active={active} />
      {active === "genel" ? <GeneralTab canEdit={canSensitive} /> : null}
      {active === "sayfalar" ? <PagesTab selected={sp.sayfa} canSensitive={canSensitive} base={base} /> : null}
      {active === "sitemap" ? <SitemapTab canEdit={canSensitive} base={base} /> : null}
      {active === "veri" ? <StructuredDataTab base={base} /> : null}
      {active === "yonlendirme" ? <RedirectsTab canBulk={canSensitive} prefill={sp.kaynak} /> : null}
      {active === "robot" ? <RobotTab canRun={canSensitive} base={base} /> : null}
      {active === "yedek" ? <BackupPanel canImport={canSensitive} /> : null}
    </div>
  );
}

/* ------------------------------ Genel ------------------------------ */

async function GeneralTab({ canEdit }: { canEdit: boolean }) {
  const s = await readSeoSettingsFresh();
  return <GlobalForm value={s.global} canEdit={canEdit} />;
}

/* ------------------------------ Sayfalar ------------------------------ */

async function PagesTab({ selected, canSensitive, base }: { selected?: string; canSensitive: boolean; base: string }) {
  const [s, audit] = await Promise.all([readSeoSettingsFresh(), readAuditLatest()]);
  const rows = seoPages().map((def) => {
    const ov = s.pages[def.path];
    const view = effectivePageView(def, ov, s.global);
    const kinds = (ov?.jsonLd ?? def.jsonLd).filter((k) => k !== "FAQPage");
    const graph = buildPageJsonLd({
      global: s.global,
      base,
      path: def.path,
      plans: PLANS.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry })),
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
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
                <th scope="col" className="px-4 py-2 font-semibold">Sayfa</th>
                <th scope="col" className="px-4 py-2 font-semibold">Başlık</th>
                <th scope="col" className="px-4 py-2 font-semibold">İndeks</th>
                <th scope="col" className="px-4 py-2 font-semibold">Sitemap</th>
                <th scope="col" className="px-4 py-2 font-semibold">Kontrol</th>
                <th scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ def, view, checklist, ov }) => {
                const failing = checklist.filter((c) => c.verdict !== "ok").length;
                return (
                  <tr key={def.path} className={selected === def.path ? "bg-canvas" : undefined}>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-ink-950">{def.label}</p>
                      <p className="font-mono text-xs text-text-muted">{def.path}</p>
                    </td>
                    <td className="max-w-xs px-4 py-2.5">
                      <p className="truncate text-ink-950">{view.renderedTitle}</p>
                      <p className="text-xs text-text-muted">{view.renderedTitle.length} karakter{ov ? " · özelleştirilmiş" : ""}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge tone={view.indexable ? "success" : "neutral"}>{view.indexable ? "index" : "noindex"}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge tone={view.inSitemap ? "success" : "neutral"}>{view.inSitemap ? "dahil" : "hariç"}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge tone={failing === 0 ? "success" : "attention"}>{failing === 0 ? "Tümü geçti" : `${failing} madde dikkat`}</StatusBadge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/admin/seo?sekme=sayfalar&sayfa=${encodeURIComponent(def.path)}#editor`}
                        className="focus-ring inline-flex min-h-9 items-center rounded px-2 text-sm font-semibold text-brand-700 hover:underline"
                      >
                        Düzenle
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
  const s = await readSeoSettingsFresh();
  const plans = PLANS.map((p) => ({ id: p.id, name: p.name, monthlyTry: p.monthlyTry }));
  const samples = [
    { path: "/", faq: FAQS as readonly { q: string; a: string }[] },
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
            <li><strong className="text-ink-950">SoftwareApplication + Offer</strong>: ana sayfa ve /fiyatlar; paket başına gerçek, KDV hariç aylık fiyat (paket kaynağı: plans.ts).</li>
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

async function RedirectsTab({ canBulk, prefill }: { canBulk: boolean; prefill?: string }) {
  const [s, nf] = await Promise.all([readSeoSettingsFresh(), listNotFound(100)]);
  const issues: RuleIssues = {};
  for (const i of analyzeRedirects(s.redirects)) (issues[i.ruleId] ??= []).push(i.message);
  const prefillFrom = prefill && prefill.startsWith("/") && !prefill.startsWith("//") ? prefill.slice(0, 300) : undefined;
  return (
    <div className="space-y-6">
      <RedirectsPanel rules={s.redirects} issues={issues} canBulk={canBulk} prefillFrom={prefillFrom} />
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
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-text-muted">
                  <th scope="col" className="px-4 py-2 font-semibold">Yol</th>
                  <th scope="col" className="px-4 py-2 font-semibold">İstek</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Son görülme</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Gönderen</th>
                  <th scope="col" className="px-4 py-2 font-semibold"><span className="sr-only">İşlem</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {nf.rows.map((r) => (
                  <tr key={r.path}>
                    <td className="max-w-xs truncate px-4 py-2.5 font-mono text-xs text-ink-950">{r.path}</td>
                    <td className="px-4 py-2.5 tabular-nums">{r.hits}</td>
                    <td className="px-4 py-2.5 text-text-muted">{formatDateTimeTr(r.last_seen_at)}</td>
                    <td className="px-4 py-2.5 text-text-muted">{r.referrer_host ?? "-"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/admin/seo?sekme=yonlendirme&kaynak=${encodeURIComponent(r.path)}`} className="focus-ring inline-flex min-h-9 items-center rounded px-2 text-sm font-semibold text-brand-700 hover:underline">
                        Yönlendir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ Robot ------------------------------ */

async function RobotTab({ canRun, base }: { canRun: boolean; base: string }) {
  const [run, history, indexNow] = await Promise.all([readAuditLatest(), readAuditHistory(), readIndexNow()]);
  const cron = CRON_JOBS.find((j) => j.job === "seo-robot");
  const maxBar = Math.max(1, ...history.map((h) => h.critical + h.warning));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>SEO robotu</CardTitle>
            <CardDescription>
              Her gün {cron?.cadenceLabel.replace("her gün ", "") ?? "04:20"} sitemap’inizdeki sayfaları KENDİ sunucunuzdan kontrol eder (harici site taraması yok): durum kodu, başlık, açıklama, canonical, OG, h1, robots, yapılandırılmış veri, yinelenenler, noindex/sitemap çelişkisi, kırık iç bağlantı örneklemesi ve robots-sitemap tutarlılığı. Kritik bulguda platform bildirimi gönderir.
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

      {history.length > 1 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Bulgu trendi</CardTitle>
              <CardDescription>Son {Math.min(history.length, 30)} çalışma: kritik ve uyarı sayısı.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ol className="flex h-28 items-end gap-1" aria-label="Çalışma başına bulgu sayısı">
              {history.slice(-30).map((h) => {
                const total = h.critical + h.warning;
                return (
                  <li key={h.at} className="flex h-full flex-1 flex-col justify-end" title={`${formatDateTimeTr(h.at)}: ${h.critical} kritik, ${h.warning} uyarı`}>
                    <span className="block w-full rounded-t bg-warning-soft" style={{ height: `${(h.warning / maxBar) * 100}%` }} />
                    <span className="block w-full bg-danger-500" style={{ height: `${(h.critical / maxBar) * 100}%`, minHeight: h.critical > 0 ? 2 : 0 }} />
                    <span className="sr-only">{total} bulgu</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {run ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Bulgular ({run.findings.length}{run.truncated ? "+" : ""})</CardTitle>
              <CardDescription>Her bulgunun yanında düzeltme önerisi ve ilgili sayfanın düzenleme bağlantısı vardır.</CardDescription>
            </div>
          </CardHeader>
          {run.findings.length === 0 ? (
            <CardContent>
              <p className="text-sm font-semibold text-success-strong">Denetlenen sayfalarda bulgu yok.</p>
            </CardContent>
          ) : (
            <ul className="divide-y divide-line">
              {run.findings.slice(0, 150).map((f, i) => {
                let path = "";
                try {
                  path = new URL(f.url).pathname;
                } catch {
                  path = "";
                }
                const editable = getSeoPage(path === "" ? "/" : path);
                return (
                  <li key={`${f.code}-${f.url}-${i}`} className="space-y-1 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={f.severity === "critical" ? "attention" : "neutral"}>{SEVERITY_LABEL[f.severity]}</StatusBadge>
                      <span className="break-all font-mono text-xs text-text-muted">{f.url}</span>
                    </div>
                    <p className="text-sm text-ink-950">{f.message}</p>
                    <p className="text-xs text-text-muted">
                      Öneri: {f.fix}{" "}
                      {editable ? (
                        <Link href={`/admin/seo?sekme=sayfalar&sayfa=${encodeURIComponent(editable.path)}#editor`} className="font-semibold text-brand-700 hover:underline">
                          Sayfayı düzenle
                        </Link>
                      ) : null}
                      {f.code === "broken-link" ? (
                        <Link href="/admin/seo?sekme=yonlendirme" className="ml-2 font-semibold text-brand-700 hover:underline">
                          Yönlendirmeler
                        </Link>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      <IndexNowPanel value={indexNow} canEdit={canRun} base={base} />
    </div>
  );
}
