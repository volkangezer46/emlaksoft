import Link from "@/components/ui/smart-link";
import { MapPinned } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listNeighborhoodNotes } from "@/lib/neighborhood-notes/load";
import { noteTagLabel } from "@/lib/neighborhood-notes/notes";
import { formatDateTr } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * İlgili mahallenin OFİS İÇİ saha notları (F5) — ilan detayı ve talep/eşleştirme ekranında görünür.
 * Yalnız oturumlu kiracı görür (RLS); vitrin/portal yüzeyinde kullanılmaz. Tablo yoksa hiçbir şey çizilmez
 * (ilan sayfasını "etkin değil" kutusuyla kirletmez); not yoksa mahalle notu ekleme bağlantısı gösterilir.
 */
export async function NeighborhoodNotesPanel({
  neighborhoodId,
  neighborhoodName,
}: {
  neighborhoodId: string | null;
  neighborhoodName?: string | null;
}) {
  if (!neighborhoodId) return null;
  const supabase = await createClient();
  const load = await listNeighborhoodNotes(supabase, { neighborhoodId, limit: 5 });
  if (!load.enabled) return null;

  const allHref = `/app/mahalle-notlari?mahalle=${neighborhoodId}`;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <MapPinned className="h-4 w-4 text-brand-600" /> Mahalle notları{neighborhoodName ? ` · ${neighborhoodName}` : ""}
          </CardTitle>
          <CardDescription>Ofis içi saha notları; vitrinde ve portallarda görünmez.</CardDescription>
        </div>
        <Link href={allHref} className="focus-ring press shrink-0 text-xs font-semibold text-brand-600 hover:underline">
          {load.notes.length > 0 ? "Tümü" : "Not ekle"}
        </Link>
      </CardHeader>
      <CardContent>
        {load.notes.length === 0 ? (
          <p className="text-sm text-text-muted">
            Bu mahalle için henüz saha notu yok.{" "}
            <Link href={allHref} className="font-semibold text-brand-600 hover:underline">
              İlk notu siz ekleyin
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-3">
            {load.notes.map((n) => (
              <li key={n.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  {n.tags.map((t) => (
                    <Link
                      key={t}
                      href={`/app/mahalle-notlari?mahalle=${neighborhoodId}&etiket=${t}`}
                      className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-700"
                    >
                      {noteTagLabel(t)}
                    </Link>
                  ))}
                </div>
                <p className="mt-1 whitespace-pre-line text-text">{n.body}</p>
                <p className="mt-0.5 text-xs text-text-faint">
                  {n.authorName ?? "Ofis"} · {formatDateTr(n.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
