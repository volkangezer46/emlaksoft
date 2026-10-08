import { CheckCircle2, Megaphone, Pin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { daysAgoIso } from "@/lib/clock";
import { AnnouncementReadButton } from "@/components/app/announcement-read-button";
import { EmptyState } from "@/components/ui/empty-state";

type AnnRow = { id: string; title: string; body: string; level: string; pinned: boolean };

/**
 * Ofis duyuruları (okuyucu görünümü): yayında olan duyurular, okunmamışlar önce; her birinde "Okudum" düğmesi.
 * Eskiden ana ekranda "N okunmamış duyuru" satırıydı; ana ekran sadeleştirmesiyle buraya (Bildirimler > Duyurular) taşındı —
 * veri ve okundu davranışı aynı (`announcements` + `announcement_reads`), zil paneli bu sekmeye bağlanır.
 */
export async function DuyuruAkisi() {
  const user = await getRequestUser();
  if (!user) return null;

  const supabase = await createClient();
  const nowIso = daysAgoIso(0);
  // Aktif duyurular: yayına girmiş (starts_at geçmiş) ve bitmemiş (ends_at yok/gelecek)
  const { data: rows } = await supabase
    .from("announcements")
    .select("id, title, body, level, pinned")
    .lte("starts_at", nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  const announcements = (rows ?? []) as AnnRow[];
  if (announcements.length === 0) {
    return <EmptyState variant="compact" illustration="basari" title="Yayında duyuru yok" description="Ofis yönetimi bir duyuru yayınladığında burada görünür." />;
  }

  const { data: readRows } = await supabase
    .from("announcement_reads")
    .select("announcement_id")
    .eq("user_id", user.id)
    .in("announcement_id", announcements.map((a) => a.id));
  const readSet = new Set((readRows ?? []).map((r) => r.announcement_id));
  const unread = announcements.filter((a) => !readSet.has(a.id));
  const ordered = [...unread, ...announcements.filter((a) => readSet.has(a.id))];

  return (
    <section aria-labelledby="duyuru-akisi-baslik" className="ds-card ds-pad">
      <header className="ds-head mb-3">
        <span className="pm-ico pm-t-brand" aria-hidden="true">
          <Megaphone />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="duyuru-akisi-baslik" className="ds-title">
            Duyurular
          </h2>
          <p className="ds-sub mt-0.5">{unread.length > 0 ? `${unread.length} okunmamış duyuru` : "Tüm duyurular okundu"}</p>
        </div>
      </header>
      <ul className="space-y-2">
        {ordered.map((a) => {
          const read = readSet.has(a.id);
          return (
            <li
              key={a.id}
              className={`flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 ${read ? "opacity-55" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
                  {a.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden="true" /> : null}
                  <span className="min-w-0 truncate">{a.title}</span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{a.body}</p>
              </div>
              {read ? (
                <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-mint-600">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Okundu
                </span>
              ) : (
                <AnnouncementReadButton id={a.id} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
