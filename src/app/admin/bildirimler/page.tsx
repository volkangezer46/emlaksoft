import Link from "next/link";
import { Bell, BellRing, CheckCheck, Inbox, MailOpen } from "lucide-react";
import { requirePlatformStaff } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  markAllPlatformNotificationsReadForm,
  markPlatformNotificationReadForm,
} from "@/app/actions/platform-notifications";
import { relativeTimeTR } from "@/lib/admin-format";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminStatCard, AdminStatGrid } from "@/components/admin/admin-stat-card";
import { AdminEmpty, AdminPanel } from "@/components/admin/admin-table";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";

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

function buildHref(p: { tur?: string; durum?: string; sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.tur) sp.set("tur", p.tur);
  if (p.durum) sp.set("durum", p.durum);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/bildirimler?${s}` : "/admin/bildirimler";
}

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tur?: string; durum?: string; sayfa?: string }>;
}) {
  const staff = await requirePlatformStaff();
  const sp = (await searchParams) ?? {};
  const tur = sp.tur && kindLabel[sp.tur] ? sp.tur : undefined;
  const durum = sp.durum === "okunmamis" || sp.durum === "okunmus" ? sp.durum : undefined;
  const page = parsePage(sp.sayfa);
  const filtered = Boolean(tur || durum);

  const admin = createAdminClient();

  // Liste filtreye göre daralır; sayaçlar HER ZAMAN tüm gelen kutusunu gösterir
  // (filtre açıkken "0 okunmamış" gibi yanıltıcı bir özet çıkmasın).
  let listQuery = admin
    .from("platform_notifications")
    .select("id, title, body, href, kind, read_at, created_at", { count: "exact" })
    .eq("staff_id", staff.id);
  if (tur) listQuery = listQuery.eq("kind", tur);
  if (durum === "okunmamis") listQuery = listQuery.is("read_at", null);
  if (durum === "okunmus") listQuery = listQuery.not("read_at", "is", null);

  const [{ data, count }, { count: totalAll }, { count: unreadAll }, { count: criticalUnread }] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).range(...pageRange(page)),
    admin.from("platform_notifications").select("id", { count: "exact", head: true }).eq("staff_id", staff.id),
    admin.from("platform_notifications").select("id", { count: "exact", head: true }).eq("staff_id", staff.id).is("read_at", null),
    admin
      .from("platform_notifications")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staff.id)
      .is("read_at", null)
      .in("kind", ["danger", "warning"]),
  ]);

  const rows = data ?? [];
  const total = totalAll ?? 0;
  const unread = unreadAll ?? 0;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="Gelen kutusu"
        icon={BellRing}
        title="Bildirimler"
        description={
          unread > 0
            ? `${unread} okunmamış bildirim bekliyor — kart üzerinden filtreleyebilirsiniz.`
            : "Tüm bildirimler okundu. Yeni demo talepleri ve sistem uyarıları burada belirir."
        }
        glow="brand"
        actions={
          unread > 0 ? (
            <form action={markAllPlatformNotificationsReadForm}>
              <button
                type="submit"
                className="focus-ring press inline-flex items-center gap-2 rounded-[10px] border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:border-white/35 hover:bg-white/15"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Tümünü okundu işaretle
              </button>
            </form>
          ) : null
        }
      >
        <AdminStatGrid className="mt-6">
          <AdminStatCard
            tone="dark"
            label="Toplam bildirim"
            value={total || null}
            href={total ? buildHref({}) : undefined}
            icon={Inbox}
            accent="text-brand-300"
            emptyHint="Henüz bildirim yok"
          />
          <AdminStatCard
            tone="dark"
            label="Okunmamış"
            value={total ? unread : null}
            href={total ? buildHref({ tur, durum: durum === "okunmamis" ? undefined : "okunmamis" }) : undefined}
            icon={Bell}
            accent="text-amber-300"
            hint={durum === "okunmamis" ? "filtre aktif · kaldırmak için tıkla" : "yalnızca okunmamışları göster"}
            emptyHint="Henüz bildirim yok"
          />
          <AdminStatCard
            tone="dark"
            label="Okundu"
            value={total ? total - unread : null}
            href={total ? buildHref({ tur, durum: durum === "okunmus" ? undefined : "okunmus" }) : undefined}
            icon={MailOpen}
            accent="text-mint-400"
            hint={durum === "okunmus" ? "filtre aktif · kaldırmak için tıkla" : undefined}
            emptyHint="Henüz bildirim yok"
          />
          <AdminStatCard
            tone="dark"
            label="Bekleyen kritik/uyarı"
            value={total ? (criticalUnread ?? 0) : null}
            href={total ? buildHref({ tur: "danger" }) : undefined}
            icon={BellRing}
            accent="text-danger-300"
            hint="okunmamış danger + warning"
            emptyHint="Henüz bildirim yok"
          />
        </AdminStatGrid>
      </AdminPageHeader>

      <nav aria-label="Tür filtresi" className="flex flex-wrap gap-2 rounded-[16px] border border-line bg-surface p-3">
        <Link href={buildHref({ durum })} aria-current={!tur ? "page" : undefined} className={chipCls(!tur)}>
          Tümü
        </Link>
        {Object.entries(kindLabel).map(([v, l]) => (
          <Link
            key={v}
            href={buildHref({ tur: tur === v ? undefined : v, durum })}
            aria-current={tur === v ? "page" : undefined}
            className={chipCls(tur === v)}
          >
            {l}
          </Link>
        ))}
        {durum ? (
          <Link href={buildHref({ tur })} className={`${chipCls(true)} ml-auto`}>
            {durum === "okunmamis" ? "Okunmamış" : "Okundu"} · filtreyi kaldır
          </Link>
        ) : null}
      </nav>

      <AdminPanel
        title="Gelen kutusu"
        icon={Bell}
        actions={<span className="text-xs text-text-faint">{count ?? 0} kayıt</span>}
      >
        {rows.length === 0 ? (
          <AdminEmpty
            icon={Inbox}
            title={filtered ? "Bu filtrede bildirim yok" : "Henüz bildirim yok"}
            description={
              filtered
                ? "Filtreyi temizleyip tüm bildirimlere bakabilirsiniz."
                : "Yeni demo talepleri, abonelik uyarıları ve sistem mesajları burada görünür."
            }
            action={
              filtered ? (
                <Link
                  href="/admin/bildirimler"
                  className="focus-ring press inline-flex rounded-[10px] border border-line px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-400"
                >
                  Filtreyi temizle
                </Link>
              ) : null
            }
          />
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
                      href={buildHref({ tur: tur === n.kind ? undefined : n.kind, durum })}
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
      </AdminPanel>

      <Pagination page={page} total={count ?? 0} hrefFor={(p) => buildHref({ tur, durum, sayfa: p })} />
    </div>
  );
}
