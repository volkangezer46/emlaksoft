import Link from "next/link";
import { ArrowUpRight, Bell, BellRing, CheckCheck, Gauge, Inbox, Sparkles } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import {
  markAllNotificationsReadForm,
  markNotificationReadForm,
} from "@/app/actions/notifications";
import { relativeTimeTR } from "@/lib/admin-format";
import { daysAgoIso } from "@/lib/clock";

/**
 * Tenant bildirim arşivi — zil panelindeki son 30 kaydın sayfalı/filtreli tam
 * listesi. Sorgu mantığı zil ile aynı (bkz. listMyNotifications): RLS + kendi
 * user_id'si veya tenant-geneli (user_id IS NULL) bildirimler.
 *
 * Filtre kontratı: ?durum=okunmamis, ?tur=<kind>, ?sayfa= — URL sorguya
 * yansır, çipler URL'i günceller (sunucu filtre + gerçek sayfalama).
 *
 * Hero KPI'ları gerçek count sorgularından gelir; her kart tıklanınca ilgili
 * filtre uygulanır (parametreleri bu sayfa okur).
 */

// Palet: Ink / Brand / Mint / Amber / Cyan — mor kullanılmaz.
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

const PAGE_SIZE = 50;

const chipCls = (active: boolean) =>
  `focus-ring press inline-flex min-h-[36px] items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-xs font-semibold transition ${
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
  const mineOr = `user_id.eq.${ctx.userId},user_id.is.null`;

  // Zilin sorgusu (listMyNotifications) sayfa ölçeğine taşındı: RLS tenant'ı
  // süzer, or() kullanıcıya özel + tenant-geneli kayıtları getirir.
  let listQuery = supabase
    .from("notifications")
    .select("id, title, body, href, kind, read_at, created_at", { count: "exact" })
    .or(mineOr);
  if (durum) listQuery = listQuery.is("read_at", null);
  if (tur) listQuery = listQuery.eq("kind", tur);

  const countBase = () => supabase.from("notifications").select("id", { count: "exact", head: true }).or(mineOr);

  const kindKeys = Object.keys(kindLabel);
  const [{ data, count }, { count: unreadCount }, { count: allCount }, { count: weekCount }, ...kindCountRes] =
    await Promise.all([
      listQuery.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1),
      countBase().is("read_at", null),
      countBase(),
      countBase().gte("created_at", daysAgoIso(7)),
      ...kindKeys.map((k) => countBase().eq("kind", k)),
    ]);

  const kindCounts: Record<string, number> = {};
  kindKeys.forEach((k, i) => {
    kindCounts[k] = kindCountRes[i]?.count ?? 0;
  });

  const rows = data ?? [];
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const unread = unreadCount ?? 0;
  const totalAll = allCount ?? 0;
  const week = weekCount ?? 0;
  const readRate = totalAll > 0 ? Math.round(((totalAll - unread) / totalAll) * 100) : 100;
  const topKind = kindKeys.reduce<string | null>(
    (best, k) => (best === null || kindCounts[k] > kindCounts[best] ? k : best),
    null,
  );

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

  const kpis = [
    {
      label: "Toplam bildirim",
      value: totalAll,
      icon: Bell,
      href: buildHref({ durum: null, tur: null, sayfa: 1 }),
      accent: "text-white",
      active: !filtersActive,
    },
    {
      // Etiket, aşağıdaki filtre çipiyle aynı olmasın: aynı sayfada iki özdeş
      // bağlantı adı hem erişilebilirlik (ekran okuyucu) hem test açısından belirsiz.
      label: "Okunmamış bildirim",
      value: unread,
      icon: BellRing,
      href: buildHref({ durum: "okunmamis", tur: null, sayfa: 1 }),
      accent: unread > 0 ? "text-amber-300" : "text-mint-400",
      active: Boolean(durum),
    },
    {
      label: "Son 7 gün",
      value: week,
      icon: Sparkles,
      href: buildHref({ durum: null, tur: null, sayfa: 1 }),
      accent: "text-cyan-400",
      active: false,
    },
    {
      label: "Okunma oranı",
      value: `%${readRate}`,
      icon: Gauge,
      href: buildHref({ durum: "okunmamis", tur: null, sayfa: 1 }),
      accent: readRate >= 80 ? "text-mint-400" : "text-amber-300",
      active: false,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Koyu hero — KPI şeridi filtre kısayoludur */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-5 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/30 blur-[80px]" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-amber-400/12 blur-[70px]" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
                <Bell className="h-4 w-4" /> Bildirim merkezi
              </span>
              <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Bildirimler</h1>
              <p className="mt-1 text-sm text-white/65">
                {unread > 0 ? `${unread} okunmamış bildiriminiz var.` : "Tüm bildirimler okundu — güncel durumdasınız."}
                {tur ? ` · "${kindLabel[tur]}" türü filtrede` : ""}
                {durum ? " · yalnız okunmamışlar" : ""}
              </p>
            </div>
            {unread > 0 ? (
              <form action={markAllNotificationsReadForm}>
                <button
                  type="submit"
                  className="focus-ring press inline-flex min-h-[40px] items-center gap-2 rounded-[10px] border border-white/20 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white/85 transition hover:border-white/40 hover:text-white"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> Tümünü okundu işaretle
                </button>
              </form>
            ) : null}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => {
              const Icon = k.icon;
              return (
                <Link
                  key={k.label}
                  href={k.href}
                  className={`focus-ring press group relative block rounded-[14px] border bg-white/5 p-3.5 transition hover:border-white/30 ${
                    k.active && filtersActive ? "border-white/40" : "border-white/10"
                  }`}
                >
                  <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <span className="flex items-center gap-1.5 text-[11px] text-white/50">
                    <Icon className="h-3.5 w-3.5" /> {k.label}
                  </span>
                  <p className={`numeric mt-1.5 font-display text-xl font-extrabold tabular-nums ${k.accent}`}>{k.value}</p>
                </Link>
              );
            })}
          </div>

          {topKind && kindCounts[topKind] > 0 ? (
            <p className="mt-4 text-[11px] text-white/50">
              En yoğun tür:{" "}
              <Link
                href={buildHref({ tur: topKind, sayfa: 1 })}
                className="font-semibold text-white/80 underline-offset-2 hover:text-white hover:underline"
              >
                {kindLabel[topKind]} ({kindCounts[topKind]})
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      {/* Filtre çipleri: durum + tür — URL iki yönlü (aktifken tıklama kaldırır) */}
      <nav aria-label="Bildirim filtresi" className="flex flex-wrap items-center gap-2">
        <Link href={buildHref({ durum: null, tur: null })} aria-current={!filtersActive ? "page" : undefined} className={chipCls(!filtersActive)}>
          Tümü{totalAll > 0 ? ` (${totalAll})` : ""}
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
            <span className={`h-2 w-2 rounded-full ${dotColor[v]}`} />
            {l}
            {kindCounts[v] > 0 ? ` (${kindCounts[v]})` : ""}
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
          <div className="relative overflow-hidden px-4 py-16 text-center">
            <div className="pointer-events-none absolute left-1/2 top-4 h-32 w-32 -translate-x-1/2 rounded-full bg-brand-600/15 blur-[60px]" />
            <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-[16px] bg-brand-600/10 text-brand-600">
              <Inbox className="h-7 w-7" />
            </span>
            <p className="relative mt-3 text-sm font-semibold text-ink-950">
              {filtersActive ? "Filtreye uyan bildirim yok" : total > 0 ? "Bu sayfada kayıt yok" : "Henüz bildirim yok"}
            </p>
            <p className="relative mt-1 text-xs text-text-muted">
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
                "Randevu hatırlatmaları, eşleşme haberleri ve sistem duyuruları burada birikecek."
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
                      className="focus-ring press grid h-10 w-10 place-items-center rounded-[8px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
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
              <Link href={buildHref({ sayfa: page - 1 })} className="focus-ring press inline-flex min-h-[40px] items-center rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                ← Önceki
              </Link>
            ) : (
              <span className="inline-flex min-h-[40px] items-center rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">Sayfa {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={buildHref({ sayfa: page + 1 })} className="focus-ring press inline-flex min-h-[40px] items-center rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                Sonraki →
              </Link>
            ) : (
              <span className="inline-flex min-h-[40px] items-center rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
