import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { PageHeader } from "@/components/ui/page-header";
import { loadFeedPage, normalizeFeedFilters } from "@/lib/oversight/feed-query";
import { loadProfileNames } from "@/lib/oversight/load";
import { OversightNav } from "../_components/oversight-nav";
import { FeedFiltersForm } from "../_components/feed-filters";
import { FeedList, feedAssignedIds } from "../_components/feed-list";
import { PrivacyNote } from "../_components/privacy-note";

const PATH = "/app/ofis-kontrol/benim";

/** Danışmanın KENDİ işlem akışı: sorgu `aktor` parametresini yok sayar, her zaman oturum sahibine kilitlidir. */
export default async function BenimAkisimPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const { tenantId, userId, role } = await requireModulePage("dashboard", PATH);
  const office = hasOfficeWideDataScope(role);
  const sp = (await searchParams) ?? {};
  const filters = { ...normalizeFeedFilters(sp), aktor: "" };
  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "1", 10) || 1);

  const supabase = await createClient();
  const feed = tenantId
    ? await loadFeedPage(supabase, tenantId, filters, page, userId)
    : { rows: [], total: 0, page: 1, totalPages: 1, failed: false };
  const names = new Map<string, string>();
  if (tenantId) {
    const ids = feedAssignedIds(feed.rows);
    if (ids.length) for (const [id, n] of await loadProfileNames(supabase, tenantId, ids)) names.set(id, n);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ofis Kontrol Merkezi"
        title="Benim akışım"
        description="Sistemde yaptığınız işlemlerin kendi kayıtlarınız burada listelenir. Ofis yönetimi iş süreçlerinin düzeni için bu kayıtları görebilir; siz de burada aynısını görürsünüz."
      />
      <OversightNav active="benim" office={office} />
      <FeedFiltersForm filters={filters} advisors={[]} basePath={PATH} hideActor />
      <FeedList data={feed} names={names} filters={filters} basePath={PATH} selfView />
      <PrivacyNote audience="advisor" />
    </div>
  );
}
