import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Building2, MapPinned, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { listNeighborhoodNotes, neighborhoodLabels } from "@/lib/neighborhood-notes/load";
import { NOTE_TAGS, countByTag, isUuid, noteTagLabel, parseTagFilter } from "@/lib/neighborhood-notes/notes";
import { formatDateTr } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NeighborhoodNoteForm } from "./note-form";
import { DeleteNoteButton } from "./delete-note-button";
import { getParentsOf, provinceOptionsResult } from "@/lib/geo/reader";

export const metadata = { title: "Mahalle notları" };

const PATH = "/app/mahalle-notlari";
const LIMIT = 200;

function href(params: { mahalle?: string | null; etiket?: string | null }): string {
  const p = new URLSearchParams();
  if (params.mahalle) p.set("mahalle", params.mahalle);
  if (params.etiket) p.set("etiket", params.etiket);
  const s = p.toString();
  return s ? `${PATH}?${s}` : PATH;
}

/**
 * Mahalle notları (F5): ofisin kendi saha bilgisi. Yalnız ofis içi; public yüzeye çıkmaz.
 * URL kontratı: ?mahalle=<uuid> ?etiket=<ulasim|okul|gurultu|yatirim|dikkat|genel>.
 */
export default async function NeighborhoodNotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ mahalle?: string; etiket?: string }>;
}) {
  const { perms } = await requireModulePage("properties");
  const canCreate = (perms.properties ?? []).includes("create");
  const canEdit = (perms.properties ?? []).includes("edit");
  const sp = (await searchParams) ?? {};
  const mahalleF = isUuid(sp.mahalle) ? sp.mahalle : null;
  const tagF = parseTagFilter(sp.etiket);

  const supabase = await createClient();
  // Sayaçlar mahalle filtresi bağlamında, etiket filtresi HARİÇ (çip sayısı kendi filtresini yemesin).
  const [load, scope, provincesRes] = await Promise.all([
    listNeighborhoodNotes(supabase, { neighborhoodId: mahalleF ?? undefined, tag: tagF, limit: LIMIT }),
    listNeighborhoodNotes(supabase, { neighborhoodId: mahalleF ?? undefined, limit: LIMIT }),
    provinceOptionsResult(),
  ]);
  const provinces = (provincesRes.data ?? []) as { id: string; name: string }[];

  if (!load.enabled || !scope.enabled) {
    return (
      <div className="space-y-5">
        <PageHeader title="Mahalle notları" description="Ofis içi saha notları: ulaşım, okul, gürültü, yatırım potansiyeli." />
        <EmptyState
          icon={MapPinned}
          title="Mahalle notları bu ortamda etkin değil"
          description="Not tablosu henüz kurulmamış. Veritabanı güncellemesi uygulandığında bu ekran otomatik açılır."
          action={{ href: "/app/portfoyler", label: "Portföylere dön" }}
        />
      </div>
    );
  }

  const notes = load.notes;
  const tagCounts = countByTag(scope.notes);
  const labels = await neighborhoodLabels(supabase, [...notes.map((n) => n.neighborhood_id), ...(mahalleF ? [mahalleF] : [])]);

  // Seçili mahalle varsa formu o mahalleyle açmak için il/ilçe zincirini çöz.
  let defaults: { province: string | null; district: string | null } = { province: null, district: null };
  if (mahalleF) {
    const parents = await getParentsOf({ neighborhood_id: mahalleF });
    if (parents.districtId) defaults = { province: parents.provinceId, district: parents.districtId };
  }

  const groups = new Map<string, typeof notes>();
  for (const n of notes) groups.set(n.neighborhood_id, [...(groups.get(n.neighborhood_id) ?? []), n]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mahalle notları"
        description="Ofisin kendi saha bilgisi: ulaşım, okul, gürültü, yatırım potansiyeli ve dikkat edilecekler. Yalnız ofis içinde görünür, vitrine çıkmaz."
      />

      {/* Etiket çipleri — hem sayaç hem filtre */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href({ mahalle: mahalleF })}
          aria-current={!tagF ? "page" : undefined}
          className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-bold transition ${
            !tagF ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-300"
          }`}
        >
          Tümü · {scope.notes.length}
        </Link>
        {NOTE_TAGS.map((t) => (
          <Link
            key={t.value}
            href={href({ mahalle: mahalleF, etiket: tagF === t.value ? null : t.value })}
            aria-current={tagF === t.value ? "page" : undefined}
            className={`focus-ring press rounded-full px-3 py-1.5 text-xs font-bold transition ${
              tagF === t.value ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-300"
            } ${tagCounts[t.value] === 0 ? "opacity-55" : ""}`}
          >
            {t.label} · {tagCounts[t.value]}
          </Link>
        ))}
        {mahalleF ? (
          <Link
            href={href({ etiket: tagF })}
            className="focus-ring press inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-700"
          >
            Mahalle: {labels.get(mahalleF) ?? "seçili"} <X className="h-3 w-3" aria-hidden />
            <span className="sr-only">filtreyi kaldır</span>
          </Link>
        ) : null}
      </div>

      {canCreate ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Yeni saha notu</CardTitle>
              <CardDescription>Mahalleyi seçin, etiketleyin ve notunuzu yazın. Not sizin adınızla ve bugünün tarihiyle kaydedilir.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <NeighborhoodNoteForm
              provinces={provinces}
              defaultProvinceId={defaults.province}
              defaultDistrictId={defaults.district}
              defaultNeighborhoodId={mahalleF}
            />
          </CardContent>
        </Card>
      ) : null}

      {notes.length === 0 ? (
        <EmptyState
          icon={MapPinned}
          title={tagF || mahalleF ? "Bu filtreyle not yok" : "Henüz mahalle notu yok"}
          description={
            tagF || mahalleF
              ? "Filtreyi kaldırıp tüm notlara bakın veya bu mahalle için ilk notu ekleyin."
              : "Sahada öğrendiklerinizi (metro yürüme süresi, gürültü, okul) mahalle bazında kaydedin; ilan ve talep ekranında görünür."
          }
          action={tagF || mahalleF ? { href: PATH, label: "Filtreyi kaldır" } : undefined}
          secondary={{ href: "/app/portfoyler", label: "Portföylere git" }}
        />
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([neighborhoodId, items]) => (
            <Card key={neighborhoodId}>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MapPinned className="h-4 w-4 text-brand-600" />
                    <Link href={href({ mahalle: neighborhoodId })} className="hover:underline">
                      {labels.get(neighborhoodId) ?? "Mahalle"}
                    </Link>
                  </CardTitle>
                  <CardDescription>{items.length} not</CardDescription>
                </div>
                <Link
                  href={`/app/portfoyler?mahalle=${neighborhoodId}`}
                  className="focus-ring press inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
                >
                  <Building2 className="h-3.5 w-3.5" aria-hidden /> Bu mahalledeki portföyler <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-line">
                  {items.map((n) => (
                    <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {n.tags.length === 0 ? <span className="text-xs text-text-faint">Etiketsiz</span> : null}
                        {n.tags.map((t) => (
                          <Link
                            key={t}
                            href={href({ mahalle: mahalleF, etiket: t })}
                            className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700"
                          >
                            {noteTagLabel(t)}
                          </Link>
                        ))}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm text-text">{n.body}</p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-text-faint">
                          {n.authorName ?? "Ofis"} · {formatDateTr(n.created_at)}
                        </p>
                        {canEdit ? <DeleteNoteButton id={n.id} /> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
          {scope.notes.length >= LIMIT ? (
            <p className="text-xs text-text-muted">En yeni {LIMIT} not gösteriliyor; mahalle veya etiketle daraltın.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
