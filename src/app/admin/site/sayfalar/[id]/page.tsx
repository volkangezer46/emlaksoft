import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getBaseUrl } from "@/lib/base-url";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { buildRedirectMap, normalizeRedirectPath, withLegacyRedirects } from "@/lib/seo/redirects";
import { readSeoSettingsFresh } from "@/lib/seo/store";
import { PAGE_KIND_LABEL, samePage } from "@/lib/site-pages/schema-core";
import { readSitePageIndex, sitePageStore } from "@/lib/site-pages/store";
import { SitePageEditor, type PageHistoryView } from "./page-editor";

export const metadata = { title: "Sayfa düzenle" };

/** Tek özel sayfanın editörü: bloklar, SEO paneli, taslak/yayın/arşiv, geçmiş ve personel önizlemesi. */
export default async function AdminSitePageEditPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePlatformModule("sitecontent");
  const { id } = await params;
  if (!/^[a-f0-9]{12}$/.test(id)) notFound();
  const [index, state, seo] = await Promise.all([readSitePageIndex(), sitePageStore(id).readState(), readSeoSettingsFresh()]);
  const entry = index.find((e) => e.id === id);
  if (!entry) notFound();
  const draft = state.draft ?? state.live;
  if (!draft) notFound();

  const redirects = buildRedirectMap(withLegacyRedirects(seo.redirects));
  const history: PageHistoryView[] = state.history.map((h, i) => ({
    id: h.id,
    atLabel: toTrLocalInput(h.at).replace("T", " "),
    by: h.by,
    label: h.label,
    isLive: i === 0 && entry.status === "yayinda" && state.live !== null && samePage(h.cfg, state.live),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="document"
        eyebrow={`Sayfalar · ${PAGE_KIND_LABEL[entry.kind]}`}
        icon={FileText}
        title={entry.title}
        description="Bloklar düz metindir (HTML işlenmez). Önce taslağı kaydedin; Yayınla ile sayfa canlıya alınır ve sitemap'e girer. Yayından kaldırılan sayfa 404 döner; içerik ve geçmiş saklanır."
        glow="brand"
      />
      <SitePageEditor
        id={id}
        entry={entry}
        initialDraft={draft}
        live={state.live}
        history={history}
        canWrite={staff.role === "super_admin"}
        baseUrl={getBaseUrl()}
        titleTemplate={seo.global.titleTemplate}
        hasRedirect={redirects.has(normalizeRedirectPath(`/${entry.slug}`))}
        otherPaths={index.filter((e) => e.id !== id).map((e) => `/${e.slug}`)}
      />
    </div>
  );
}
