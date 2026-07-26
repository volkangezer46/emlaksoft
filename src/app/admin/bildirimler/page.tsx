import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { requirePlatformStaff } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  markAllPlatformNotificationsReadForm,
  markPlatformNotificationReadForm,
} from "@/app/actions/platform-notifications";
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

const chipCls = (active: boolean) =>
  `focus-ring press rounded-[9px] px-3 py-1.5 text-xs font-semibold transition ${
    active ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
  }`;

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tur?: string }>;
}) {
  const staff = await requirePlatformStaff();
  const sp = (await searchParams) ?? {};
  const tur = sp.tur && kindLabel[sp.tur] ? sp.tur : undefined;

  const admin = createAdminClient();

  let listQuery = admin
    .from("platform_notifications")
    .select("id, title, body, href, kind, read_at, created_at")
    .eq("staff_id", staff.id);
  if (tur) listQuery = listQuery.eq("kind", tur);
  const { data } = await listQuery.order("created_at", { ascending: false }).limit(200);

  const rows = data ?? [];
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold text-ink-950 md:text-2xl">Bildirimler</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {unread > 0 ? `${unread} okunmamış bildirim` : "Tüm bildirimler okundu"}
            {tur ? ` · "${kindLabel[tur]}" türü filtrede` : ""}
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

      <nav aria-label="Tür filtresi" className="flex flex-wrap gap-2">
        <Link href="/admin/bildirimler" aria-current={!tur ? "page" : undefined} className={chipCls(!tur)}>
          Tümü
        </Link>
        {Object.entries(kindLabel).map(([v, l]) => (
          <Link
            key={v}
            href={tur === v ? "/admin/bildirimler" : `/admin/bildirimler?tur=${v}`}
            aria-current={tur === v ? "page" : undefined}
            className={chipCls(tur === v)}
          >
            {l}
          </Link>
        ))}
      </nav>

      <section className="dashboard-panel overflow-hidden rounded-[18px] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Bell className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-semibold text-ink-950">Gelen kutusu</p>
          <span className="ml-auto text-xs text-text-faint">{rows.length} kayıt</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Inbox className="mx-auto h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm font-semibold text-ink-950">
              {tur ? `"${kindLabel[tur]}" türünde bildirim yok` : "Henüz bildirim yok"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {tur ? "Filtreyi temizleyip tüm bildirimlere bakabilirsiniz." : "Yeni demo talepleri ve sistem uyarıları burada görünür."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {rows.map((n) => (
              <div
                key={n.id}
                className={`relative flex items-start gap-3 px-5 py-3.5 transition hover:bg-canvas/60 ${
                  n.read_at ? "" : "bg-brand-600/[0.03]"
                }`}
              >
                {/* Satır tıklaması: href varsa gezinme, yoksa tekil okundu işaretleme */}
                {n.href ? (
                  <Link href={n.href} className="absolute inset-0" aria-label={n.title} />
                ) : !n.read_at ? (
                  <form action={markPlatformNotificationReadForm} className="absolute inset-0">
                    <input type="hidden" name="id" value={n.id} />
                    <button
                      type="submit"
                      className="h-full w-full cursor-pointer"
                      title="Okundu işaretle"
                      aria-label={`${n.title} bildirimini okundu işaretle`}
                    />
                  </form>
                ) : null}
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "bg-line-strong" : dotColor[n.kind] ?? "bg-brand-500"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`truncate text-sm ${n.read_at ? "font-medium" : "font-semibold"} text-ink-950`}>{n.title}</p>
                    <Link
                      href={tur === n.kind ? "/admin/bildirimler" : `/admin/bildirimler?tur=${n.kind}`}
                      title={`"${kindLabel[n.kind] ?? n.kind}" türünü filtrele`}
                      className="relative z-10 shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600"
                    >
                      {kindLabel[n.kind] ?? n.kind}
                    </Link>
                  </div>
                  {n.body ? <p className="mt-0.5 truncate text-xs text-text-muted">{n.body}</p> : null}
                </div>
                <span className="shrink-0 text-[11px] text-text-faint">{relativeTimeTR(n.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
