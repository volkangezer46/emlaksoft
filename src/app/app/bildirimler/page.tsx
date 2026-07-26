import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import {
  markAllNotificationsReadForm,
  markNotificationReadForm,
} from "@/app/actions/notifications";
import { relativeTimeTR } from "@/lib/admin-format";

/**
 * Tenant bildirim arşivi — zil panelindeki son 30 kaydın sayfalı/filtreli tam
 * listesi. Sorgu mantığı zil ile aynı (bkz. listMyNotifications): RLS + kendi
 * user_id'si veya tenant-geneli (user_id IS NULL) bildirimler.
 *
 * Filtre kontratı: ?durum=okunmamis, ?tur=<kind>, ?sayfa= — URL sorguya
 * yansır, çipler URL'i günceller (sunucu filtre + gerçek sayfalama).
 */

const dotColor: Record<string, string> = {
  success: "bg-mint-500",
  info: "bg-brand-500",
  warning: "bg-amber-400",
  danger: "bg-danger-500",
  system: "bg-violet-500",
};

const kindLabel: Record<string, string> = {
  success: "Başarılı",
  info: "Bilgi",
  warning: "Uyarı",
  danger: "Kritik",
  system: "Sistem",
};

const PAGE_SIZE = 50;

const chipCls = (active: boolean) =>
  `focus-ring press rounded-[9px] px-3 py-1.5 text-xs font-semibold transition ${
    active ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
  }`;

export default async function BildirimlerPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; tur?: string; sayfa?: string }>;
}) {
  const ctx = await requireModulePage("dashboard");
  const sp = (await searchParams) ?? {};
  const durum = sp.durum === "okunmamis" ? "okunmamis" : undefined;
  const tur = sp.tur && kindLabel[sp.tur] ? sp.tur : undefined;
  const pageParam = Math.max(1, Number.parseInt(sp.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;

  const supabase = await createClient();

  // Zilin sorgusu (listMyNotifications) sayfa ölçeğine taşındı: RLS tenant'ı
  // süzer, or() kullanıcıya özel + tenant-geneli kayıtları getirir.
  let listQuery = supabase
    .from("notifications")
    .select("id, title, body, href, kind, read_at, created_at", { count: "exact" })
    .or(`user_id.eq.${ctx.userId},user_id.is.null`);
  if (durum) listQuery = listQuery.is("read_at", null);
  if (tur) listQuery = listQuery.eq("kind", tur);

  const [{ data, count }, { count: unreadCount }] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .or(`user_id.eq.${ctx.userId},user_id.is.null`)
      .is("read_at", null),
  ]);

  const rows = data ?? [];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const unread = unreadCount ?? 0;

  /** Aktif filtreleri koruyarak link üretir (sayfa değişince filtre kaybolmasın). */
  const buildHref = (patch: { durum?: string | null; tur?: string | null; sayfa?: number }) => {
    const params = new URLSearchParams();
    const d = patch.durum === undefined ? durum : patch.durum ?? undefined;
    const t = patch.tur === undefined ? tur : patch.tur ?? undefined;
    if (d) params.set("durum", d);
    if (t) params.set("tur", t);
    if ((patch.sayfa ?? 1) > 1) params.set("sayfa", String(patch.sayfa));
    const qs = params.toString();
    return qs ? `/app/bildirimler?${qs}` : "/app/bildirimler";
  };

  const filtersActive = Boolean(durum || tur);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold text-ink-950 md:text-2xl">Bildirimler</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {unread > 0 ? `${unread} okunmamış bildirim` : "Tüm bildirimler okundu"}
            {tur ? ` · "${kindLabel[tur]}" türü filtrede` : ""}
            {durum ? " · yalnız okunmamışlar" : ""}
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllNotificationsReadForm}>
            <button
              type="submit"
              className="focus-ring press inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Tümünü okundu işaretle
            </button>
          </form>
        ) : null}
      </div>

      {/* Filtre çipleri: durum + tür — URL iki yönlü (aktifken tıklama kaldırır) */}
      <nav aria-label="Bildirim filtresi" className="flex flex-wrap items-center gap-2">
        <Link href={buildHref({ durum: null, tur: null })} aria-current={!filtersActive ? "page" : undefined} className={chipCls(!filtersActive)}>
          Tümü
        </Link>
        <Link
          href={buildHref({ durum: durum ? null : "okunmamis" })}
          aria-current={durum ? "page" : undefined}
          className={chipCls(Boolean(durum))}
        >
          Okunmamış{unread > 0 ? ` (${unread})` : ""}
        </Link>
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {Object.entries(kindLabel).map(([v, l]) => (
          <Link
            key={v}
            href={buildHref({ tur: tur === v ? null : v })}
            aria-current={tur === v ? "page" : undefined}
            className={chipCls(tur === v)}
          >
            {l}
          </Link>
        ))}
      </nav>

      <section className="overflow-hidden rounded-[18px] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Bell className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-semibold text-ink-950">Gelen kutusu</p>
          <span className="ml-auto text-xs tabular-nums text-text-faint">{total} kayıt</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Inbox className="mx-auto h-8 w-8 text-text-faint" />
            <p className="mt-3 text-sm font-semibold text-ink-950">
              {filtersActive ? "Filtreye uyan bildirim yok" : total > 0 ? "Bu sayfada kayıt yok" : "Henüz bildirim yok"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {filtersActive ? (
                <>
                  <Link href="/app/bildirimler" className="font-semibold text-brand-600 hover:underline">
                    Filtreyi temizleyip
                  </Link>{" "}
                  tüm bildirimlere bakabilirsiniz.
                </>
              ) : total > 0 ? (
                <>
                  Sayfa numarası aralık dışında.{" "}
                  <Link href={buildHref({ sayfa: 1 })} className="font-semibold text-brand-600 hover:underline">
                    İlk sayfaya dön
                  </Link>
                </>
              ) : (
                "Yeni etkinlikler burada görünecek."
              )}
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
                  <form action={markNotificationReadForm} className="absolute inset-0">
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
                      href={buildHref({ tur: tur === n.kind ? null : n.kind })}
                      title={`"${kindLabel[n.kind] ?? n.kind}" türünü filtrele`}
                      className="relative z-10 shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600"
                    >
                      {kindLabel[n.kind] ?? n.kind}
                    </Link>
                  </div>
                  {n.body ? <p className="mt-0.5 truncate text-xs text-text-muted">{n.body}</p> : null}
                </div>
                {/* href'li okunmamış satırda gezinmeden bağımsız okundu düğmesi */}
                {n.href && !n.read_at ? (
                  <form action={markNotificationReadForm} className="relative z-10 shrink-0">
                    <input type="hidden" name="id" value={n.id} />
                    <button
                      type="submit"
                      title="Okundu işaretle"
                      aria-label={`${n.title} bildirimini okundu işaretle`}
                      className="focus-ring press grid h-7 w-7 place-items-center rounded-[8px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  </form>
                ) : null}
                <span className="shrink-0 text-[11px] text-text-faint">{relativeTimeTR(n.created_at)}</span>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link href={buildHref({ sayfa: page - 1 })} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                ← Önceki
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">Sayfa {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={buildHref({ sayfa: page + 1 })} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                Sonraki →
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
