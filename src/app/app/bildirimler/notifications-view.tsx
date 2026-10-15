import { batchAll } from "@/lib/supabase/query-batch";
import { FilterChip } from "@/components/ui/filter-chip";
import { Button } from "@/components/ui/button";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Bell, BellRing, CheckCheck, Gauge, Inbox, Sparkles } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import {
  markAllNotificationsReadForm,
  markNotificationReadForm,
} from "@/app/actions/notifications";
import { daysAgoIso, now } from "@/lib/clock";
import { isMissingFunctionError, recordRpcOutcome, rpcKnownMissing } from "@/lib/supabase/rpc-probe";
import { notificationHref, parseNotificationCounts, stripNotificationMarker, type NotificationCounts } from "@/lib/notification-text";
import { MarkReadForm } from "./mark-read-form";

import { PageHeader } from "@/components/ui/page-header";
import { groupNotifications, notificationTimeLabel } from "./group-notifications";
/**
 * Tenant bildirim arşivi — zil panelindeki son 30 kaydın sayfalı/filtreli tam
 * listesi. Sorgu mantığı zil ile aynı (bkz. listMyNotifications): RLS + kendi
 * user_id'si veya tenant-geneli (user_id IS NULL) bildirimler. Okunma durumu
 * KİŞİ BAŞINA `notification_reads`'ten (ortak bildirim herkese ayrı okunur);
 * sayaçlar zil ile AYNI kaynaktan: `my_notification_counts()` (tek RPC turu).
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

export async function NotificationsView({
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
  const { rows: data, total: count, counts } = await loadNotificationsPage(supabase, ctx.userId, { durum, tur, offset });

  const kindKeys = Object.keys(kindLabel);
  const kindCounts: Record<string, number> = {};
  for (const k of kindKeys) kindCounts[k] = counts.kinds[k] ?? 0;

  // Gövde sonundaki makine izi (` · task:<uuid>`) gösterilmez; izden kayda daha yakın bağlantı türetilir.
  const rows = (data ?? []).map((r) => ({ ...r, body: stripNotificationMarker(r.body), href: notificationHref(r) }));
  // Aynı başlık + türdeki tekrarlı kayıtlar (ör. cron uyarıları) bu sayfada tek satır: "× N".
  const groups = groupNotifications(rows);
  const nowMs = now();
  const total = count ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const unread = counts.unread;
  const totalAll = counts.total;
  const week = counts.week;
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
      <PageHeader title="Bildirimler" eyebrow="Bildirim merkezi" description={`${unread > 0 ? `${unread} okunmamış bildiriminiz var.` : "Tüm bildirimler okundu — güncel durumdasınız."}${tur ? ` · "${kindLabel[tur]}" türü filtrede` : ""}${durum ? " · yalnız okunmamışlar" : ""}`} actions={<>{unread > 0 ? (
              <MarkReadForm action={markAllNotificationsReadForm} errorFallback="Bildirimler okundu işaretlenemedi">
                <Button type="submit" variant="outline" size="sm" icon={CheckCheck}>
                  Tümünü okundu işaretle
                </Button>
              </MarkReadForm>
            ) : null}</>} />
<section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-5 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/30 blur-[80px]" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-amber-400/12 blur-[70px]" />
        <div className="relative">
          

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => {
              const Icon = k.icon;
              return (
                <Link
                  key={k.label}
                  href={k.href}
                  className={`focus-ring press group relative block rounded-[var(--radius-card)] border bg-white/5 p-3.5 transition hover:border-white/30 ${
                    k.active && filtersActive ? "border-white/40" : "border-white/10"
                  }`}
                >
                  <ArrowUpRight className="hover-action absolute right-2.5 top-2.5 h-3.5 w-3.5 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <span className="flex items-center gap-1.5 text-xs text-white/50">
                    <Icon className="h-3.5 w-3.5" /> {k.label}
                  </span>
                  <p className={`numeric mt-1.5 font-display text-xl font-extrabold tabular-nums ${k.accent}`}>{k.value}</p>
                </Link>
              );
            })}
          </div>

          {topKind && kindCounts[topKind] > 0 ? (
            <p className="mt-4 text-xs text-white/50">
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
        <FilterChip href={buildHref({ durum: null, tur: null })} active={!filtersActive}>
          Tümü{totalAll > 0 ? ` (${totalAll})` : ""}
        </FilterChip>
        <FilterChip href={buildHref({ durum: durum ? null : "okunmamis" })} active={Boolean(durum)}>
          Okunmamış{unread > 0 ? ` (${unread})` : ""}
        </FilterChip>
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {Object.entries(kindLabel).map(([v, l]) => (
          <FilterChip key={v} href={buildHref({ tur: tur === v ? null : v })} active={tur === v}>
            <span className={`h-2 w-2 rounded-full ${dotColor[v]}`} />
            {l}
            {kindCounts[v] > 0 ? ` (${kindCounts[v]})` : ""}
          </FilterChip>
        ))}
      </nav>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Bell className="h-4 w-4 text-brand-600" />
          <p className="text-sm font-semibold text-ink-950">Gelen kutusu</p>
          <span className="ml-auto text-xs tabular-nums text-text-faint">{total} kayıt</span>
        </div>

        {rows.length === 0 ? (
          <div className="relative overflow-hidden px-4 py-16 text-center">
            <div className="pointer-events-none absolute left-1/2 top-4 h-32 w-32 -translate-x-1/2 rounded-full bg-brand-600/15 blur-[60px]" />
            <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
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
            {groups.map(({ head: n, count: groupCount, unreadIds }) => (
              <div
                key={n.id}
                className={`relative flex items-start gap-3 px-5 py-3.5 transition hover:bg-canvas/60 ${
                  n.read_at ? "" : "bg-brand-600/[0.03]"
                }`}
              >
                {/* Satır tıklaması: href varsa gezinme, yoksa tekil okundu işaretleme */}
                {n.href ? (
                  <Link href={n.href} className="absolute inset-0" aria-label={n.title} />
                ) : unreadIds.length > 0 ? (
                  <MarkReadForm action={markNotificationReadForm} ids={unreadIds} className="absolute inset-0">
                    <button
                      type="submit"
                      className="h-full w-full cursor-pointer"
                      title="Okundu işaretle"
                      aria-label={`${n.title} bildirimini okundu işaretle`}
                    />
                  </MarkReadForm>
                ) : null}
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? "bg-line-strong" : dotColor[n.kind] ?? "bg-brand-500"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`truncate text-sm ${n.read_at ? "font-medium" : "font-semibold"} text-ink-950`}>{n.title}</p>
                    {groupCount > 1 ? (
                      <span
                        className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-xs font-semibold tabular-nums text-text-muted"
                        title={`Bu sayfada aynı başlıkta ${groupCount} bildirim`}
                      >
                        × {groupCount}
                      </span>
                    ) : null}
                    <Link
                      href={buildHref({ tur: tur === n.kind ? null : n.kind })}
                      title={`"${kindLabel[n.kind] ?? n.kind}" türünü filtrele`}
                      className="relative z-10 shrink-0 rounded-full bg-canvas px-1.5 py-0.5 text-xs font-bold uppercase tracking-[0.08em] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600"
                    >
                      {kindLabel[n.kind] ?? n.kind}
                    </Link>
                  </div>
                  {n.body ? <p className="mt-0.5 truncate text-xs text-text-muted">{n.body}</p> : null}
                </div>
                {/* href'li okunmamış satırda gezinmeden bağımsız okundu düğmesi */}
                {n.href && unreadIds.length > 0 ? (
                  <MarkReadForm action={markNotificationReadForm} ids={unreadIds} className="relative z-10 shrink-0">
                    <button
                      type="submit"
                      title="Okundu işaretle"
                      aria-label={`${n.title} bildirimini okundu işaretle`}
                      className="focus-ring press grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11 touch:min-w-11"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  </MarkReadForm>
                ) : null}
                <span className="shrink-0 text-xs text-text-faint">
                  <time dateTime={n.created_at}>{notificationTimeLabel(n.created_at, nowMs)}</time>
                </span>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link href={buildHref({ sayfa: page - 1 })} className="focus-ring press inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11">
                ← Önceki
              </Link>
            ) : (
              <span className="inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">Sayfa {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={buildHref({ sayfa: page + 1 })} className="focus-ring press inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 touch:min-h-11">
                Sonraki →
              </Link>
            ) : (
              <span className="inline-flex min-h-[40px] items-center rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}

type NotificationListRow = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  kind: string;
  read_at: string | null;
  created_at: string;
};
type ReadEmbed = { read_at: string | null }[] | null;
type Db = Awaited<ReturnType<typeof createClient>>;

const COUNTS_RPC = "my_notification_counts";

/**
 * Sayfa verisi: liste (sunucu süzgeci + gerçek sayfalama) + sayaçlar. Okunma kişi başı tablodan gömülür; "okunmamış"
 * süzgeci PostgREST anti-join'i (`reads=is.null`, gömme kendi satırıyla sınırlı). Sayaçlar tek RPC. Migration yoksa
 * (RPC/tablo yok) eski tek sütun (`notifications.read_at`) sorgularına düşer.
 */
async function loadNotificationsPage(
  supabase: Db,
  userId: string,
  opts: { durum?: string; tur?: string; offset: number },
): Promise<{ rows: NotificationListRow[]; total: number; counts: NotificationCounts }> {
  const mineOr = `user_id.eq.${userId},user_id.is.null`;
  const range = [opts.offset, opts.offset + PAGE_SIZE - 1] as const;

  if (!rpcKnownMissing(COUNTS_RPC)) {
    let listQuery = supabase
      .from("notifications")
      .select("id, title, body, href, kind, created_at, reads:notification_reads(read_at)", { count: "exact" })
      .or(mineOr)
      .eq("reads.user_id", userId);
    if (opts.durum) listQuery = listQuery.is("reads", null);
    if (opts.tur) listQuery = listQuery.eq("kind", opts.tur);
    const [list, countsRes] = await batchAll("Bildirimler", [], [
      listQuery.order("created_at", { ascending: false }).range(range[0], range[1]),
      supabase.rpc(COUNTS_RPC),
    ]);
    recordRpcOutcome(COUNTS_RPC, countsRes.error);
    if (!isMissingFunctionError(countsRes.error) && !list.error) {
      const rows = ((list.data ?? []) as (Omit<NotificationListRow, "read_at"> & { reads: ReadEmbed })[]).map(({ reads, ...n }) => ({
        ...n,
        read_at: reads?.[0]?.read_at ?? null,
      }));
      return { rows, total: list.count ?? rows.length, counts: parseNotificationCounts(countsRes.data) };
    }
  }

  // Eski yol (migration öncesi): okunma tek sütunda, sayaçlar ayrı count sorguları.
  let listQuery = supabase
    .from("notifications")
    .select("id, title, body, href, kind, read_at, created_at", { count: "exact" })
    .or(mineOr);
  if (opts.durum) listQuery = listQuery.is("read_at", null);
  if (opts.tur) listQuery = listQuery.eq("kind", opts.tur);
  const countBase = () => supabase.from("notifications").select("id", { count: "exact", head: true }).or(mineOr);
  const kindKeys = Object.keys(kindLabel);
  const [{ data, count }, { count: unreadCount }, { count: allCount }, { count: weekCount }, ...kindCountRes] =
    await batchAll("Bildirimler", [], [
      listQuery.order("created_at", { ascending: false }).range(range[0], range[1]),
      countBase().is("read_at", null),
      countBase(),
      countBase().gte("created_at", daysAgoIso(7)),
      ...kindKeys.map((k) => countBase().eq("kind", k)),
    ]);
  const kinds: Record<string, number> = {};
  kindKeys.forEach((k, i) => {
    kinds[k] = kindCountRes[i]?.count ?? 0;
  });
  const rows = (data ?? []) as NotificationListRow[];
  return {
    rows,
    total: count ?? rows.length,
    counts: { unread: unreadCount ?? 0, total: allCount ?? 0, week: weekCount ?? 0, kinds },
  };
}
