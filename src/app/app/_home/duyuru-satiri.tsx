import { CheckCircle2, ChevronDown, Megaphone, Pin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { daysAgoIso } from "@/lib/clock";
import { AnnouncementReadButton } from "@/components/app/announcement-read-button";

type AnnRow = { id: string; title: string; body: string; level: string; pinned: boolean };

/**
 * Duyuru özeti — tek satır: "3 okunmamış duyuru". Tıklayınca (details) açılır,
 * her duyuruda "Okudum" düğmesi var. Okunmamış yoksa hiç render edilmez.
 */
export async function DuyuruSatiri() {
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
  if (announcements.length === 0) return null;

  const { data: readRows } = await supabase
    .from("announcement_reads")
    .select("announcement_id")
    .eq("user_id", user.id)
    .in("announcement_id", announcements.map((a) => a.id));
  const readSet = new Set((readRows ?? []).map((r) => r.announcement_id));
  const unread = announcements.filter((a) => !readSet.has(a.id));
  if (unread.length === 0) return null; // sıfır gürültü

  const ordered = [...unread, ...announcements.filter((a) => readSet.has(a.id))];

  return (
    <details className="group surface-card rounded-[var(--radius-card)]">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2.5 rounded-[var(--radius-card)] px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
          <Megaphone className="h-3.5 w-3.5" />
        </span>
        <span className="shrink-0 text-sm font-semibold text-ink-950">{unread.length} okunmamış duyuru</span>
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">· {unread[0].title}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-faint transition group-open:rotate-180" />
      </summary>
      <ul className="space-y-2 px-4 pb-4">
        {ordered.map((a) => {
          const read = readSet.has(a.id);
          return (
            <li
              key={a.id}
              className={`flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 ${read ? "opacity-55" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
                  {a.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-brand-600" /> : null}
                  <span className="min-w-0 truncate">{a.title}</span>
                </p>
                <p className="mt-0.5 line-clamp-3 text-xs leading-relaxed text-text-muted">{a.body}</p>
              </div>
              {read ? (
                <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-mint-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Okundu
                </span>
              ) : (
                <AnnouncementReadButton id={a.id} />
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
