import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { requirePlatformStaff } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { markAllPlatformNotificationsReadForm } from "@/app/actions/platform-notifications";
import { relativeTimeTR } from "@/lib/admin-format";

const dotColor: Record<string, string> = {
  success: "bg-mint-500",
  info: "bg-brand-500",
  warning: "bg-amber-400",
  danger: "bg-danger-500",
  system: "bg-cyan-400",
};

const kindLabel: Record<string, string> = {
  success: "Başarılı",
  info: "Bilgi",
  warning: "Uyarı",
  danger: "Kritik",
  system: "Sistem",
};

export default async function AdminNotificationsPage() {
  const staff = await requirePlatformStaff();
  const admin = createAdminClient();

  const { data } = await admin
    .from("platform_notifications")
    .select("id, title, body, href, kind, read_at, created_at")
    .eq("staff_id", staff.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = data ?? [];
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold text-ink-950 md:text-2xl">Bildirimler</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {unread > 0 ? `${unread} okunmamış bildirim` : "Tüm bildirimler okundu"}
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllPlatformNotificationsReadForm}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Tümünü okundu işaretle
            </button>
          </form>
        ) : null}
      </div>

      <section className="dashboard-panel overflow-hidden rounded-[18px] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Bell className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-semibold text-ink-950">Gelen kutusu</p>
          <span className="ml-auto text-xs text-text-faint">{rows.length} kayıt</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Inbox className="mx-auto h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm font-semibold text-ink-950">Henüz bildirim yok</p>
            <p className="mt-1 text-xs text-text-muted">Yeni demo talepleri ve sistem uyarıları burada görünür.</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((n) => {
              const inner = (
                <>
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "bg-line-strong" : dotColor[n.kind] ?? "bg-brand-500"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`truncate text-sm ${n.read_at ? "font-medium" : "font-semibold"} text-ink-950`}>{n.title}</p>
                      <span className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-text-faint">
                        {kindLabel[n.kind] ?? n.kind}
                      </span>
                    </div>
                    {n.body ? <p className="mt-0.5 truncate text-xs text-text-muted">{n.body}</p> : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-text-faint">{relativeTimeTR(n.created_at)}</span>
                </>
              );
              const cls = `flex items-start gap-3 px-5 py-3.5 transition hover:bg-canvas/60 ${n.read_at ? "" : "bg-brand-600/[0.03]"}`;
              return n.href ? (
                <Link key={n.id} href={n.href} className={cls}>
                  {inner}
                </Link>
              ) : (
                <div key={n.id} className={cls}>
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
