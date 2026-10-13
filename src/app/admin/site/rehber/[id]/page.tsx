import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { getBaseUrl } from "@/lib/base-url";
import { toTrLocalInput } from "@/lib/clock";
import { GUIDE_CATEGORY_LABEL, sameGuide } from "@/lib/guides/defaults";
import { guideLinkPaths, guideStore, readGuideIndex } from "@/lib/guides/store";
import { requirePlatformModule } from "@/lib/platform";
import { readSeoSettingsFresh } from "@/lib/seo/store";
import { GuideEditor, type GuideHistoryView } from "./guide-editor";

export const metadata = { title: "Rehber yazısı" };

/** Tek yazının editörü: bloklar, SEO kartı, taslak/yayın/geri alma, geçmiş ve personel önizlemesi. */
export default async function AdminGuideEditPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePlatformModule("sitecontent");
  const { id } = await params;
  if (!/^[a-f0-9]{12}$/.test(id)) notFound();
  const [index, state, seo] = await Promise.all([readGuideIndex(), guideStore(id).readState(), readSeoSettingsFresh()]);
  const entry = index.find((e) => e.id === id);
  if (!entry) notFound();
  const draft = state.draft ?? state.live;
  if (!draft) notFound();

  const history: GuideHistoryView[] = state.history.map((h, i) => ({
    id: h.id,
    atLabel: toTrLocalInput(h.at).replace("T", " "),
    by: h.by,
    label: h.label,
    isLive: i === 0 && entry.status === "yayinda" && state.live !== null && sameGuide(h.cfg, state.live),
  }));

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow={`Rehber · ${GUIDE_CATEGORY_LABEL[entry.category]}`}
        icon={FileText}
        title={entry.title}
        description="Gövde bloklardan oluşur; ham HTML işlenmez. Satır içinde yalnız **kalın**, *italik* ve [bağlantı](/yol) kullanılır. Taslak canlı yazıyı değiştirmez; Yayınla ile canlıya alınır."
        glow="brand"
      />
      <GuideEditor
        id={id}
        entry={entry}
        initialDraft={draft}
        live={state.live}
        history={history}
        canPublish={staff.role === "super_admin"}
        baseUrl={getBaseUrl()}
        titleTemplate={seo.global.titleTemplate}
        linkPaths={guideLinkPaths(index.filter((e) => e.status === "yayinda"), id)}
      />
    </div>
  );
}
