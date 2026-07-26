import { CheckCircle2, Info, Megaphone, Pin, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { daysAgoIso } from "@/lib/clock";
import { AnnouncementReadButton } from "./announcement-read-button";

/**
 * Dashboard duyuru bandı — ofis içi duyuru panosu.
 *
 * Sıfır gürültü kuralı: kullanıcının OKUMADIĞI aktif duyuru yoksa band hiç
 * render edilmez. Okunmamışlar önce (pinned öncelikli), en fazla 2 satır açık
 * görünür; kalanı (okunmuşlar dahil) details/summary ile genişler.
 */

type AnnRow = {
  id: string;
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  ends_at: string | null;
};

const LEVEL_META: Record<string, { border: string; bg: string; iconTone: string; icon: React.ComponentType<{ className?: string }> }> = {
  info: { border: "border-brand-600/25", bg: "bg-brand-600/[0.05]", iconTone: "bg-brand-600/10 text-brand-600", icon: Info },
  warning: { border: "border-amber-400/40", bg: "bg-amber-400/[0.07]", iconTone: "bg-amber-400/20 text-amber-600", icon: TriangleAlert },
  success: { border: "border-mint-500/30", bg: "bg-mint-500/[0.06]", iconTone: "bg-mint-500/12 text-mint-600", icon: CheckCircle2 },
};

function AnnouncementRow({ ann, read }: { ann: AnnRow; read: boolean }) {
  const meta = LEVEL_META[ann.level] ?? LEVEL_META.info;
  const LevelIcon = meta.icon;
  return (
    <li className={`flex items-start gap-3 rounded-[13px] border ${meta.border} ${meta.bg} px-3.5 py-3 ${read ? "opacity-55" : ""}`}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${meta.iconTone}`}>
        <LevelIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink-950">
          {ann.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-brand-600" /> : null}
          <span className="min-w-0 truncate">{ann.title}</span>
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">{ann.body}</p>
      </div>
      {read ? (
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-mint-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Okundu
        </span>
      ) : (
        <AnnouncementReadButton id={ann.id} />
      )}
    </li>
  );
}

export async function AnnouncementsBanner() {
  const user = await getRequestUser();
  if (!user) return null;

  const supabase = await createClient();
  const nowIso = daysAgoIso(0);

  // Aktif duyurular: yayına girmiş (starts_at geçmiş) ve bitmemiş (ends_at yok/gelecek)
  const { data: rows } = await supabase
    .from("announcements")
    .select("id, title, body, level, pinned, ends_at")
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
  // Sıfır gürültü: hepsi okunduysa band görünmez
  if (unread.length === 0) return null;

  const read = announcements.filter((a) => readSet.has(a.id));
  const ordered = [...unread, ...read]; // okunmamışlar önce (her iki grup pinned-önce sıralı)
  const visible = ordered.slice(0, 2);
  const rest = ordered.slice(2);

  return (
    <section className="surface-card rounded-[18px] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-brand-600/10 text-brand-600">
            <Megaphone className="h-4 w-4" />
          </span>
          Ofis duyuruları
        </h2>
        <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-semibold text-brand-600">
          {unread.length} okunmamış
        </span>
      </div>

      <ul className="mt-3 space-y-2">
        {visible.map((a) => (
          <AnnouncementRow key={a.id} ann={a} read={readSet.has(a.id)} />
        ))}
      </ul>

      {rest.length > 0 ? (
        <details className="group mt-2">
          <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1 rounded-[9px] px-2 py-1.5 text-xs font-semibold text-brand-600 transition hover:text-brand-700 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Tümünü göster ({announcements.length})</span>
            <span className="hidden group-open:inline">Daralt</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {rest.map((a) => (
              <AnnouncementRow key={a.id} ann={a} read={readSet.has(a.id)} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
