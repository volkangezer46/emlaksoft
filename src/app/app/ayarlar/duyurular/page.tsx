import Link from "next/link";
import { ArrowLeft, Megaphone, Users2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { isPast } from "@/lib/clock";
import { AnnouncementsManager, type AnnouncementRow } from "./announcements-manager";

export const metadata = { title: "Duyurular" };

export default async function AnnouncementsSettingsPage() {
  const { tenantId } = await requireModulePage("settings");
  const supabase = await createClient();

  const [{ data: rows }, { count: teamCount }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, level, pinned, starts_at, ends_at, created_at, creator:created_by(full_name)")
      .eq("tenant_id", tenantId)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  const list = (rows ?? []) as unknown as (Omit<AnnouncementRow, "readCount"> & { creator: { full_name: string | null } | null })[];

  // Okunma sayıları — TEK toplu sorgu, sonra bellekte grupla ("5/8" rozeti)
  const ids = list.map((a) => a.id);
  const readCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: reads } = await supabase
      .from("announcement_reads")
      .select("announcement_id")
      .in("announcement_id", ids);
    for (const r of reads ?? []) {
      readCounts.set(r.announcement_id, (readCounts.get(r.announcement_id) ?? 0) + 1);
    }
  }

  const announcements: AnnouncementRow[] = list.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    level: a.level,
    pinned: a.pinned,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    created_at: a.created_at,
    creatorName: a.creator?.full_name ?? null,
    readCount: readCounts.get(a.id) ?? 0,
  }));

  // Yayında = başlamış (starts_at geçmiş) ve bitmemiş (ends_at yok ya da gelecekte)
  const activeCount = announcements.filter((a) => isPast(a.starts_at) && (!a.ends_at || !isPast(a.ends_at))).length;

  return (
    <div className="space-y-6">
      <Link href="/app/ayarlar" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <Megaphone className="h-4 w-4" /> Duyuru panosu
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Ofis içi duyurular</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Ekibinize toplantı, komisyon oranı veya kampanya duyurusu yayınlayın. Duyurular herkesin
              dashboard&apos;unda görünür; kim okudu buradan takip edilir.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-[14px] border border-white/12 bg-white/[0.05] px-5 py-3">
            <Users2 className="h-5 w-5 text-mint-300" />
            <div>
              <p className="font-display text-xl font-extrabold text-mint-300">{activeCount}</p>
              <p className="text-[11px] text-white/55">yayında duyuru</p>
            </div>
          </div>
        </div>
      </section>

      <AnnouncementsManager announcements={announcements} teamCount={teamCount ?? 0} />
    </div>
  );
}
